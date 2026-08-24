import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { db } from '../../db/client.ts';
import { lexemes, tokens } from '../../db/schema.ts';
import type { AnalyzedToken } from '../analyzer/types.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Identity of a Library entry, namespaced by the dictionary that produced it. */
interface LexemeKey {
  dictionary: string;
  lemma: string;
  reading: string;
  pos: string;
}

/**
 * Written alongside a new lexeme but not part of its identity -- see the
 * `posDetail` comment in the schema. Recorded so that JMdict matching can tell
 * homographs apart later, without the analyzer having to be re-run.
 */
interface LexemeHints {
  posDetail: string | null;
  conjugationType: string | null;
}

/**
 * NUL as the separator, because no analyzer output can contain one -- a
 * space would let a lemma with a space in it collide with the next field.
 * Written as an escape rather than a literal byte: a literal NUL makes git
 * classify this file as binary, and it has never shown a diff for it.
 */
const keyOf = (k: LexemeKey) =>
  `${k.dictionary}\u0000${k.lemma}\u0000${k.reading}\u0000${k.pos}`;

/**
 * Resolves a lexeme to its id, creating it on first sight. The cache spans one
 * import so a chapter with 4000 tokens does not run 4000 lookups.
 */
export class LexemeResolver {
  private readonly cache = new Map<string, string>();
  private readonly tx: Tx;

  constructor(tx: Tx) {
    this.tx = tx;
  }

  resolve(key: LexemeKey, hints: LexemeHints): string {
    const cacheKey = keyOf(key);
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) return cached;

    const existing = this.tx
      .select({ id: lexemes.id })
      .from(lexemes)
      .where(
        and(
          eq(lexemes.dictionary, key.dictionary),
          eq(lexemes.lemma, key.lemma),
          eq(lexemes.reading, key.reading),
          eq(lexemes.pos, key.pos),
        ),
      )
      .get();

    const id = existing?.id ?? randomUUID();
    if (!existing) {
      this.tx.insert(lexemes).values({ id, ...key, ...hints }).run();
    }
    this.cache.set(cacheKey, id);
    return id;
  }
}

/** IPADIC's placeholder for "no value". */
const blank = (raw: string): string | null => (raw === '' || raw === '*' ? null : raw);

/**
 * The single place token rows are written.
 *
 * Import passes tokens whose offsets are relative to the whole section, so they
 * are rebased here against the sentence. A future sentence edit will analyze
 * just that sentence, whose tokens already start at zero, and pass
 * `sentenceStart: 0` -- same function, same invariant. Keeping one writer is
 * what makes correcting a transcript a feature rather than a parallel pipeline.
 *
 * Postcondition: for every row written,
 *   sentence.text.slice(charStart, charEnd) === surface
 */
export function writeSentenceTokens(
  tx: Tx,
  resolver: LexemeResolver,
  options: {
    sentenceId: string;
    sentenceStart: number;
    dictionary: string;
    analyzed: AnalyzedToken[];
  },
): void {
  const { sentenceId, sentenceStart, dictionary, analyzed } = options;
  if (analyzed.length === 0) return;

  const rows = analyzed.map((token, index) => ({
    id: randomUUID(),
    sentenceId,
    lexemeId: resolver.resolve(
      {
        dictionary,
        lemma: token.lemma,
        reading: token.lemmaReading,
        pos: token.pos,
      },
      {
        // IPADIC writes '*' where it has no value; the analyzer already
        // normalises that to the string, so it is dropped to null here.
        posDetail: blank(token.features.posDetail1),
        conjugationType: blank(token.features.conjugatedType),
      },
    ),
    orderIndex: index,
    charStart: token.charStart - sentenceStart,
    charEnd: token.charEnd - sentenceStart,
    surface: token.surface,
    reading: token.reading,
    features: JSON.stringify(token.features),
  }));

  // Chunked so a long chapter does not blow SQLite's variable limit.
  for (let i = 0; i < rows.length; i += 200) {
    tx.insert(tokens).values(rows.slice(i, i + 200)).run();
  }
}

/** Removes a sentence's tokens ahead of re-deriving them. */
export function clearSentenceTokens(tx: Tx, sentenceId: string): void {
  tx.delete(tokens).where(eq(tokens.sentenceId, sentenceId)).run();
}
