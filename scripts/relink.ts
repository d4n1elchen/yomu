/**
 * Re-matches every lexeme against JMdict, then asks the model again about every
 * word that came out ambiguous -- for when the matching rule or the resolver
 * prompt has changed and the links already stored were made by the old one.
 *
 * Run: npm run db:relink                  (relink, then resolve library-wide)
 *      npm run db:relink -- --no-resolve  (relink only; the drain resolves nothing,
 *                                           since every section is already stamped)
 *
 * Unlike an import, this does not grey anything: sections keep `resolvedAt`, so
 * a reader open while it runs can see a word move between entries. It is a
 * maintenance pass, run with nobody reading.
 *
 * Every pick the model changes is printed, which is the measurement: whether a
 * resolver change improves picks is only knowable by reading what it moved.
 */

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db, sqlite } from '../src/db/client.ts';
import { dictEntries, lexemes, sentences, tokens } from '../src/db/schema.ts';
import { dictionaryMatchReport, linkLexemes } from '../src/lib/dict/match.ts';
import {
  resolveOne,
  resolverContext,
  writeResolution,
  type AmbiguousLexeme,
} from '../src/lib/dict/resolve.ts';
import { getLlmProvider } from '../src/lib/llm/index.ts';

const resolve = !process.argv.includes('--no-resolve');

const headwordOf = (entryId: string | null) =>
  entryId === null
    ? '(none)'
    : (db
        .select({ headword: dictEntries.headword })
        .from(dictEntries)
        .where(eq(dictEntries.id, entryId))
        .get()?.headword ?? entryId);

const report = (label: string) => {
  const r = dictionaryMatchReport();
  process.stdout.write(
    `${label}: ${r.considered} content words, ${r.lemmaReading} on lemma+reading ` +
      `(${r.ambiguous} ambiguous), ${r.lemmaOnly} lemma only or derived, ` +
      `${r.unmatched} unmatched\n`,
  );
};

report('before');
const before = new Map(
  db
    .select({ id: lexemes.id, entryId: lexemes.dictEntryId })
    .from(lexemes)
    .all()
    .map((row) => [row.id, row.entryId]),
);

db.transaction((tx) => {
  linkLexemes(tx, { relink: true });
});
report('relinked');

if (resolve) {
  const pending: AmbiguousLexeme[] = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      posDetail: lexemes.posDetail,
      conjugationType: lexemes.conjugationType,
    })
    .from(lexemes)
    .where(and(eq(lexemes.dictMatch, 'lemma_reading_multi'), isNull(lexemes.dictResolver)))
    .all();
  process.stdout.write(`${pending.length} ambiguous lexemes to consider\n`);

  const llm = getLlmProvider();
  let asked = 0;
  for (const lexeme of pending) {
    // Any section the word occurs in; its sentences go first in the context.
    const home = db
      .select({ sectionId: sentences.sectionId })
      .from(tokens)
      .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
      .where(eq(tokens.lexemeId, lexeme.id))
      .orderBy(asc(sentences.sectionId))
      .limit(1)
      .get();
    const context = home ? resolverContext(lexeme, home.sectionId) : null;
    if (!context) continue;

    const outcome = await resolveOne(llm, context);
    if (outcome === 'abandoned') continue;
    asked += 1;
    writeResolution(lexeme.id, outcome.entryId, llm.model);

    const now = db
      .select({ entryId: lexemes.dictEntryId })
      .from(lexemes)
      .where(eq(lexemes.id, lexeme.id))
      .get()?.entryId ?? null;
    const was = before.get(lexeme.id) ?? null;
    if (now !== was) {
      process.stdout.write(
        `  ${lexeme.lemma} [${lexeme.pos}/${lexeme.posDetail ?? '-'}]: ` +
          `${headwordOf(was)} -> ${headwordOf(now)}\n`,
      );
    }
  }
  process.stdout.write(`asked the model about ${asked}\n`);
  report('resolved');
}

sqlite.close();
