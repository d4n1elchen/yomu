import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { dictEntries, dictSenses, lexemes } from '../../db/schema.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';
import {
  buildTranslationMessages,
  parseTranslation,
  TRANSLATION_FORMAT,
  type TranslationEntry,
} from './prompt.ts';

/** An entry to translate, carrying the sense ids so the reply can be written
 *  back by position. */
interface PendingEntry extends TranslationEntry {
  entryId: string;
  senseIds: string[];
}

/**
 * Every JMdict entry some word is linked to that still has an untranslated
 * sense. The queue is `glossZh is null`; the join to `lexeme` is what keeps it
 * to vocabulary that actually occurs, rather than setting the model at all
 * 253,000 senses in JMdict.
 *
 * Whole-database scope, not per-import. Scoping to the work being imported was
 * the flaw in the first cut: an entry left untranslated by one article was never
 * revisited unless a later article happened to contain it too.
 */
function pendingEntries(limit: number): PendingEntry[] {
  const entryIds = db
    .selectDistinct({ entryId: lexemes.dictEntryId })
    .from(lexemes)
    .innerJoin(dictSenses, eq(dictSenses.entryId, lexemes.dictEntryId))
    .where(isNull(dictSenses.glossZh))
    .limit(limit)
    .all()
    .map((row) => row.entryId)
    .filter((id): id is string => id !== null);

  const pending: PendingEntry[] = [];
  for (const entryId of entryIds) {
    const head = db
      .select({ headword: dictEntries.headword, reading: dictEntries.reading })
      .from(dictEntries)
      .where(eq(dictEntries.id, entryId))
      .get();
    if (!head) continue;

    // Every sense, translated or not: the model needs the whole structure to
    // keep the senses aligned, and only the null ones are written back.
    const senses = db
      .select({ id: dictSenses.id, pos: dictSenses.pos, glossEn: dictSenses.glossEn })
      .from(dictSenses)
      .where(eq(dictSenses.entryId, entryId))
      .orderBy(asc(dictSenses.orderIndex))
      .all();
    if (senses.length === 0) continue;

    pending.push({
      entryId,
      headword: head.headword,
      reading: head.reading,
      senseIds: senses.map((sense) => sense.id),
      senses: senses.map((sense) => ({ pos: sense.pos, glossEn: sense.glossEn })),
    });
  }
  return pending;
}

/**
 * Translates one entry's senses, or returns null if the model's reply cannot be
 * trusted. Retries once on a malformed or miscounted reply -- structured output
 * is not a guarantee -- then gives up so the sense stays null for the next
 * drain. A network failure is not caught here: it propagates so the caller can
 * stop the whole pass rather than hammer an unreachable host once per entry.
 */
async function translateEntry(
  provider: LlmProvider,
  entry: PendingEntry,
): Promise<string[] | null> {
  const messages = buildTranslationMessages(entry);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await collect(
      provider.stream({ messages, temperature: 0, format: TRANSLATION_FORMAT }),
    );
    const parsed = parseTranslation(raw, entry.senses.length);
    if (parsed) return parsed;
  }
  return null;
}

/** Writes the Chinese glosses back, filling only the senses still null so a
 *  translation from another model is never clobbered. One transaction, so an
 *  entry is all-or-nothing and never left half-written. */
function writeTranslations(
  senseIds: string[],
  zh: string[],
  model: string,
): void {
  db.transaction((tx) => {
    senseIds.forEach((id, index) => {
      tx.update(dictSenses)
        .set({ glossZh: zh[index]!, glossModel: model })
        .where(and(eq(dictSenses.id, id), isNull(dictSenses.glossZh)))
        .run();
    });
  });
}

/**
 * Translates every untranslated sense of every entry the vocabulary points at.
 *
 * Gates nothing. Unlike resolution this only fills `glossZh`, so a card gains
 * Chinese and no row moves -- an article is perfectly readable while this is
 * still running, showing JMdict's English until the Chinese lands.
 *
 * Returns false when the host could not be reached, leaving the rest null for
 * the next drain. A single entry the model mangles is left null and the pass
 * moves on.
 */
export async function translatePending(
  options: { provider?: LlmProvider; limit?: number } = {},
): Promise<{ reached: boolean; translated: number; exhausted: boolean }> {
  const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
  const pending = pendingEntries(limit);
  if (pending.length === 0) {
    return { reached: true, translated: 0, exhausted: true };
  }

  const llm = options.provider ?? getLlmProvider();
  let translated = 0;
  for (const entry of pending) {
    let zh: string[] | null;
    try {
      zh = await translateEntry(llm, entry);
    } catch {
      // Host unreachable: leave the remainder for the next drain.
      return { reached: false, translated, exhausted: false };
    }
    if (!zh) continue;
    writeTranslations(entry.senseIds, zh, llm.model);
    translated += 1;
  }

  // A short batch means the queue ran dry rather than the limit being hit.
  return { reached: true, translated, exhausted: pending.length < limit };
}

/** How many linked entries still have an untranslated sense. */
export function pendingTranslationCount(): number {
  return (
    db
      .select({ n: sql<number>`count(distinct ${lexemes.dictEntryId})` })
      .from(lexemes)
      .innerJoin(dictSenses, eq(dictSenses.entryId, lexemes.dictEntryId))
      .where(isNull(dictSenses.glossZh))
      .get()?.n ?? 0
  );
}

export interface TranslationProgress {
  /** Entries whose every sense now carries Chinese. */
  done: number;
  /** Entries the vocabulary points at, translated or not. */
  total: number;
}

/**
 * How far the gloss backlog has got, counted over the entries the vocabulary
 * actually points at rather than all of JMdict -- the same population
 * `translatePending` works through, so the number cannot claim progress against
 * senses nothing will ever ask for.
 *
 * An entry counts as done only when none of its senses is still null: a
 * half-translated entry is not finished, and reporting it as such would let the
 * figure sit at 100% while cards still show English.
 */
export function translationProgress(): TranslationProgress {
  const total =
    db
      .select({ n: sql<number>`count(distinct ${lexemes.dictEntryId})` })
      .from(lexemes)
      .innerJoin(dictSenses, eq(dictSenses.entryId, lexemes.dictEntryId))
      .get()?.n ?? 0;

  return { done: total - pendingTranslationCount(), total };
}
