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
 * The JMdict entries this work's words matched that still have an untranslated
 * sense -- the queue is `gloss_zh is null`, scoped to the entries a reader of
 * this article will actually be shown a card for. An entry with every sense
 * already translated (carried across a JMdict re-import, or done by an earlier
 * article) is not re-sent.
 */
function pendingEntries(workId: string): PendingEntry[] {
  const entryIds = db
    .selectDistinct({ entryId: lexemes.dictEntryId })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .innerJoin(dictSenses, eq(dictSenses.entryId, lexemes.dictEntryId))
    .where(and(eq(sections.workId, workId), isNull(dictSenses.glossZh)))
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
 * import. A network failure is not caught here: it propagates so the caller can
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
 * Translates the untranslated senses of every JMdict entry this work's words
 * matched. Lazy, at import: the words a reader is about to meet get their
 * Chinese now rather than stalling a hover later.
 *
 * If the model host is unreachable the pass stops and the rest stay null, to be
 * picked up by the next import -- reading never blocks on it. A single entry the
 * model mangles is left null and the pass moves on.
 */
export async function translatePendingForWork(
  workId: string,
  provider?: LlmProvider,
): Promise<void> {
  const pending = pendingEntries(workId);
  if (pending.length === 0) return;

  const llm = provider ?? getLlmProvider();
  for (const entry of pending) {
    let translated: string[] | null;
    try {
      translated = await translateEntry(llm, entry);
    } catch {
      // Host unreachable or the stream broke: leave the remainder for next time.
      return;
    }
    if (!translated) continue;
    writeTranslations(entry.senseIds, translated, llm.model);
  }
}
