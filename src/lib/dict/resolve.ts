import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  dictEntries,
  dictSenses,
  lexemes,
  sections,
  sentences,
  tokens,
} from '../../db/schema.ts';
import { runAbortable, yieldToInteractive } from '../analysis/priority.ts';
import { sameMeaning } from '../dictionary.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';
import { matchCandidates } from './match.ts';
import {
  buildResolverMessages,
  parseResolution,
  RESOLVER_FORMAT,
  type ResolverCandidate,
} from './resolve-prompt.ts';

/** A lexeme whose match left several entries standing, awaiting resolution. */
interface AmbiguousLexeme {
  id: string;
  lemma: string;
  reading: string;
  pos: string;
  posDetail: string | null;
  conjugationType: string | null;
}

/**
 * The `lemma_reading_multi` lexemes in a section that have not been resolved --
 * `dictResolver is null`. Only these: a clean `lemma_reading` is never touched,
 * and a link the model already resolved is never re-resolved, so the Dictionary
 * grouping does not shift under a reader between runs.
 */
export function ambiguousLexemes(sectionId: string): AmbiguousLexeme[] {
  return db
    .selectDistinct({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      posDetail: lexemes.posDetail,
      conjugationType: lexemes.conjugationType,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(
      and(
        eq(sentences.sectionId, sectionId),
        eq(lexemes.dictMatch, 'lemma_reading_multi'),
        isNull(lexemes.dictResolver),
      ),
    )
    .all();
}

/** The entry's leading gloss, headword and reading -- what tells one survivor
 *  from another. */
function candidateOf(entryId: string): ResolverCandidate | null {
  const entry = db
    .select({ headword: dictEntries.headword, reading: dictEntries.reading })
    .from(dictEntries)
    .where(eq(dictEntries.id, entryId))
    .get();
  if (!entry) return null;

  const gloss = db
    .select({ en: dictSenses.glossEn })
    .from(dictSenses)
    .where(eq(dictSenses.entryId, entryId))
    .orderBy(asc(dictSenses.orderIndex))
    .limit(1)
    .get();
  if (!gloss) return null;

  return {
    entryId,
    headword: entry.headword,
    reading: entry.reading,
    glossEn: gloss.en,
  };
}

/** A sentence this lexeme occurs in, with the surface as written -- the context
 *  the model reads the choice out of. One occurrence stands for the lexeme: the
 *  link is per-lexeme, so a single representative sentence is all there is to
 *  pick from. */
function occurrenceOf(
  lexemeId: string,
  sectionId: string,
): { sentence: string; surface: string } | null {
  return (
    db
      .select({ sentence: sentences.text, surface: tokens.surface })
      .from(tokens)
      .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
      .where(
        and(eq(tokens.lexemeId, lexemeId), eq(sentences.sectionId, sectionId)),
      )
      .orderBy(asc(sentences.orderIndex), asc(tokens.orderIndex))
      .limit(1)
      .get() ?? null
  );
}

/**
 * Asks the model which entry the word is, retrying once on a reply that names no
 * offered id. Returns the chosen entry id, or null to keep the deterministic
 * pick. A network failure propagates so the caller can stop the pass rather than
 * ask an unreachable host once per lexeme.
 */
async function resolveOne(
  provider: LlmProvider,
  context: Parameters<typeof buildResolverMessages>[0],
): Promise<{ entryId: string | null } | 'abandoned'> {
  const messages = buildResolverMessages(context);
  const ids = context.candidates.map((candidate) => candidate.entryId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = await runAbortable((signal) =>
      collect(
        provider.stream({
          messages,
          temperature: 0,
          format: RESOLVER_FORMAT,
          signal,
        }),
      ),
    );
    if (run === null) return 'abandoned';

    const chosen = parseResolution(run.value, ids);
    if (chosen) return { entryId: chosen };
  }
  return { entryId: null };
}

/**
 * Settles the homograph ambiguity in one section, where JMdict itself cannot:
 * several entries survived lemma, reading and grammar, and the commonest was
 * taken deterministically even when it is the wrong word -- なる takes 生る over
 * 成る because frequency points that way.
 *
 * Fires only where the survivors actually mean different things: two 三 both
 * glossing "three" is a choice with no visible consequence, so asking is pure
 * cost. When the model picks a valid candidate the link moves to it and the pick
 * is stamped with the model, so it reads as resolved rather than computed and is
 * never asked again.
 *
 * Stamps `section.resolvedAt` on completion, which is what makes the section
 * readable -- until then the Library greys it, because the links this pass moves
 * are the ones the Dictionary groups on.
 *
 * The three outcomes are deliberately distinct. `unreachable` is the only one
 * that should stop the drain and start a backoff; `abandoned` means a reader
 * asked a question and this pass stepped aside, which must not be mistaken for a
 * dead host or a single question would idle the drain for minutes.
 *
 * Progress counters are rewritten at the start of every run, so a resumed pass
 * reports the work actually left rather than counting what a previous run
 * already finished.
 */
export type ResolveOutcome = 'done' | 'abandoned' | 'unreachable';

export async function resolveSectionAmbiguity(
  sectionId: string,
  provider?: LlmProvider,
): Promise<ResolveOutcome> {
  const pending = ambiguousLexemes(sectionId);

  db.update(sections)
    .set({ resolveTotal: pending.length, resolveDone: 0 })
    .where(eq(sections.id, sectionId))
    .run();

  let llm: LlmProvider | null = null;
  let done = 0;

  const advance = () => {
    done += 1;
    db.update(sections)
      .set({ resolveDone: done })
      .where(eq(sections.id, sectionId))
      .run();
  };

  for (const lexeme of pending) {
    const found = matchCandidates(lexeme.lemma, lexeme.reading, lexeme);
    const candidates =
      found === null || found.survivors.length < 2
        ? []
        : found.survivors
            .map(candidateOf)
            .filter((c): c is ResolverCandidate => c !== null);

    // Only ask when the survivors genuinely differ. If every candidate reduces
    // to the same leading meaning, the deterministic pick is as good as any --
    // and the lexeme is finished without a request ever being made.
    const meanings = new Set(candidates.map((c) => sameMeaning(c.glossEn)));
    const occurrence =
      candidates.length < 2 || meanings.size < 2
        ? null
        : occurrenceOf(lexeme.id, sectionId);

    if (!occurrence) {
      advance();
      continue;
    }

    await yieldToInteractive();
    llm ??= provider ?? getLlmProvider();
    let outcome: Awaited<ReturnType<typeof resolveOne>>;
    try {
      outcome = await resolveOne(llm, {
        sentence: occurrence.sentence,
        surface: occurrence.surface,
        candidates,
      });
    } catch {
      // Host unreachable: leave this section pending for a later drain.
      return 'unreachable';
    }

    // Abandoned for a reader's question. The section stays unresolved, which is
    // its own queue, so a later drain resumes exactly here -- and crucially this
    // is not reported as a host failure.
    if (outcome === 'abandoned') return 'abandoned';

    if (outcome.entryId) {
      db.update(lexemes)
        .set({ dictEntryId: outcome.entryId, dictResolver: llm.model })
        .where(eq(lexemes.id, lexeme.id))
        .run();
    }
    advance();
  }

  db.update(sections)
    .set({ resolvedAt: Math.floor(Date.now() / 1000) })
    .where(eq(sections.id, sectionId))
    .run();

  return 'done';
}
