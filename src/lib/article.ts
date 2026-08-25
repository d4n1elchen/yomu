import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  dictEntries,
  dictSenses,
  lexemes,
  sections,
  sentences,
  tokens,
  works,
} from '../db/schema.ts';
import { contentWord } from './dictionary.ts';
import { learningGroupKeys } from './vocab.ts';

export interface ArticleToken {
  id: string;
  /** The Dictionary entry this word belongs to -- what the card links out to. */
  lexemeId: string;
  sentenceId: string;
  charStart: number;
  charEnd: number;
  surface: string;
  /** Katakana reading of this surface, or null when the analyzer has none. */
  reading: string | null;
  lemma: string;
  lemmaReading: string;
  pos: string;
  /**
   * The JMdict frequency band, 1 (commonest 500 words) to 48 (the 24,000th).
   * Null when the word is rarer than that, or matched nothing at all -- either
   * way the reader treats it as unvouched-for and marks it.
   */
  band: number | null;
  /**
   * JMdict marks the word common. The floor under `band` -- see `isHardWord`,
   * which needs both to decide anything.
   */
  common: boolean;
  /** The matched JMdict entry, and the key into `Article.senses`. */
  entryId: string | null;
  /**
   * Whether this word counts as vocabulary, decided by `contentWord` in SQL
   * rather than re-spelled here. Only content words are ever marked hard: a
   * dashed underline under を would be noise, not a difficulty signal.
   */
  contentWord: boolean;
}

/** A JMdict sense as the word card shows it. */
export interface ArticleSense {
  /** Traditional Chinese, once Phase C has translated it. */
  zh: string | null;
  /** JMdict's own English gloss -- the thing `zh` is a translation of. */
  en: string;
}

export interface ArticleSentence {
  id: string;
  text: string;
  needsReview: boolean;
  /** Whether this sentence opens a paragraph -- the reader groups on it. */
  paragraphStart: boolean;
  tokens: ArticleToken[];
}

export interface Article {
  sectionId: string;
  sectionTitle: string | null;
  workId: string;
  workTitle: string;
  author: string | null;
  origin: string;
  editState: string;
  /**
   * Distinct content words in this section, counted exactly as the Library
   * column and the Dictionary count them -- the reader's header and the
   * Library row must not put two different numbers under the same word.
   */
  vocabCount: number;
  sentences: ArticleSentence[];
  /**
   * Senses for every entry this section's words matched, keyed by entry id and
   * sent with the article rather than fetched when a card opens. Words repeat,
   * so this is far smaller than one payload per token -- and a card that has to
   * wait for a request is a stall at exactly the wrong moment.
   */
  senses: Record<string, ArticleSense[]>;
  /**
   * The Dictionary group keys currently on the 生詞 list. A token is on it when
   * `entryId ?? lexemeId` is in here -- the same grouping the Dictionary uses,
   * so 見る and 観る are one word in both places.
   *
   * Sent as keys rather than as a flag per token because words repeat, and
   * because the reader toggles them: a Set it can add to and remove from is the
   * shape the optimistic update needs.
   */
  learning: string[];
  /**
   * Whether JMdict has been imported at all. Without it every word has a null
   * band, which would mark the entire article -- so the reader hides the
   * difficulty slider rather than showing one that can only say "everything".
   */
  dictionaryReady: boolean;
}

export function getArticle(sectionId: string): Article | null {
  const head = db
    .select({
      sectionId: sections.id,
      sectionTitle: sections.title,
      origin: sections.origin,
      editState: sections.editState,
      workId: works.id,
      workTitle: works.title,
      author: works.author,
    })
    .from(sections)
    .innerJoin(works, eq(works.id, sections.workId))
    .where(eq(sections.id, sectionId))
    .get();

  if (!head) return null;

  const rows = db
    .select({
      sentenceId: sentences.id,
      sentenceText: sentences.text,
      needsReview: sentences.needsReview,
      paragraphStart: sentences.paragraphStart,
      sentenceOrder: sentences.orderIndex,
      tokenId: tokens.id,
      lexemeId: tokens.lexemeId,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
      surface: tokens.surface,
      reading: tokens.reading,
      lemma: lexemes.lemma,
      lemmaReading: lexemes.reading,
      pos: lexemes.pos,
      band: dictEntries.freqBand,
      common: dictEntries.common,
      entryId: lexemes.dictEntryId,
      contentWord: sql<number>`(${contentWord})`,
    })
    .from(sentences)
    .leftJoin(tokens, eq(tokens.sentenceId, sentences.id))
    .leftJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .leftJoin(dictEntries, eq(dictEntries.id, lexemes.dictEntryId))
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(asc(sentences.orderIndex), asc(tokens.orderIndex))
    .all();

  const bySentence = new Map<string, ArticleSentence>();
  for (const row of rows) {
    let sentence = bySentence.get(row.sentenceId);
    if (!sentence) {
      sentence = {
        id: row.sentenceId,
        text: row.sentenceText,
        needsReview: row.needsReview,
        paragraphStart: row.paragraphStart,
        tokens: [],
      };
      bySentence.set(row.sentenceId, sentence);
    }
    // Left join: a sentence with no tokens still yields one row, with nulls.
    if (row.tokenId === null) continue;
    sentence.tokens.push({
      id: row.tokenId,
      lexemeId: row.lexemeId!,
      sentenceId: row.sentenceId,
      charStart: row.charStart!,
      charEnd: row.charEnd!,
      surface: row.surface!,
      reading: row.reading,
      lemma: row.lemma!,
      lemmaReading: row.lemmaReading!,
      pos: row.pos!,
      band: row.band,
      common: row.common ?? false,
      entryId: row.entryId,
      // SQLite has no boolean; the comparison comes back as 0 or 1.
      contentWord: row.contentWord === 1,
    });
  }

  // The entries are found with a subquery rather than by binding the ids this
  // function just collected: a long chapter can touch a couple of thousand
  // distinct entries, and that many bound parameters is a limit worth not
  // discovering later.
  const senseRows = db
    .select({
      entryId: dictSenses.entryId,
      zh: dictSenses.glossZh,
      en: dictSenses.glossEn,
    })
    .from(dictSenses)
    .where(
      sql`${dictSenses.entryId} in (
        select distinct ${lexemes.dictEntryId}
        from ${tokens}
        join ${lexemes} on ${lexemes.id} = ${tokens.lexemeId}
        join ${sentences} on ${sentences.id} = ${tokens.sentenceId}
        where ${sentences.sectionId} = ${sectionId}
          and ${lexemes.dictEntryId} is not null
      )`,
    )
    .orderBy(asc(dictSenses.entryId), asc(dictSenses.orderIndex))
    .all();

  const senses: Record<string, ArticleSense[]> = {};
  for (const row of senseRows) {
    (senses[row.entryId] ??= []).push({ zh: row.zh, en: row.en });
  }

  const vocab = db
    .select({ count: sql<number>`count(distinct ${tokens.lexemeId})` })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(sql`${sentences.sectionId} = ${sectionId} and ${contentWord}
      and ${sentences.needsReview} = 0`)
    .get();

  return {
    ...head,
    vocabCount: vocab?.count ?? 0,
    sentences: [...bySentence.values()],
    senses,
    learning: learningGroupKeys(),
    dictionaryReady:
      db.select({ one: sql<number>`1` }).from(dictEntries).limit(1).get() !==
      undefined,
  };
}

export interface ArticleSummary {
  workId: string;
  title: string;
  author: string | null;
  /** The section a click opens: where you were last, else the first. */
  sectionId: string;
  createdAt: number;
  /** Most recent read across the work's sections. Null until one is stamped. */
  lastReadAt: number | null;
  /** Distinct content words, counted the way the Dictionary counts them. */
  vocabCount: number;
  /**
   * Homograph-resolution progress while the article is still being analysed, and
   * null once it is readable. Non-null means the Library greys the row and
   * refuses to link it: resolution moves `lexeme.dictEntryId`, which the
   * Dictionary groups on, so reading before it settles would show a word filed
   * under one entry and then another.
   *
   * Translation is deliberately not represented here. It only fills `glossZh`,
   * so it gates nothing and an article is readable throughout.
   */
  analysis: { done: number; total: number } | null;
}

/**
 * The Library index. One row per work, not per section: a pasted article has a
 * single section, but a book's row has to speak for all of its chapters.
 */
export function listArticles(): ArticleSummary[] {
  const workRows = db
    .select({
      workId: works.id,
      title: works.title,
      author: works.author,
      createdAt: works.createdAt,
    })
    .from(works)
    .all();

  const sectionRows = db
    .select({
      id: sections.id,
      workId: sections.workId,
      orderIndex: sections.orderIndex,
      lastReadAt: sections.lastReadAt,
      resolvedAt: sections.resolvedAt,
      resolveDone: sections.resolveDone,
      resolveTotal: sections.resolveTotal,
    })
    .from(sections)
    .orderBy(asc(sections.orderIndex))
    .all();

  // Vocabulary the Library counts is vocabulary the Dictionary would list:
  // content words only, and never from a transcript sentence nobody has
  // checked. Anything else would print a number the two pages disagree on.
  const vocabRows = db
    .select({
      workId: sections.workId,
      count: sql<number>`count(distinct ${tokens.lexemeId})`,
    })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(sql`${contentWord} and ${sentences.needsReview} = 0`)
    .groupBy(sections.workId)
    .all();

  const vocabByWork = new Map(vocabRows.map((r) => [r.workId, r.count]));

  const summaries: ArticleSummary[] = [];
  for (const work of workRows) {
    const owned = sectionRows.filter((s) => s.workId === work.workId);
    if (owned.length === 0) continue;

    const lastRead = owned.reduce<number | null>(
      (best, s) =>
        s.lastReadAt !== null && (best === null || s.lastReadAt > best)
          ? s.lastReadAt
          : best,
      null,
    );
    // Resume where you left off; a work never opened starts at its first
    // section, which the orderIndex sort already put first.
    const entry =
      owned.find((s) => s.lastReadAt !== null && s.lastReadAt === lastRead) ??
      owned[0]!;

    // A work is still analysing while any of its sections is: a book becomes
    // readable when every chapter's links have settled, not the first.
    const unresolved = owned.filter((s) => s.resolvedAt === null);

    summaries.push({
      workId: work.workId,
      title: work.title,
      author: work.author,
      sectionId: entry.id,
      createdAt: work.createdAt,
      lastReadAt: lastRead,
      vocabCount: vocabByWork.get(work.workId) ?? 0,
      analysis:
        unresolved.length === 0
          ? null
          : {
              done: owned.reduce((n, s) => n + s.resolveDone, 0),
              total: owned.reduce((n, s) => n + s.resolveTotal, 0),
            },
    });
  }

  // Reading order, with an unread import treated as freshly touched so it does
  // not appear below things read months ago.
  return summaries.sort(
    (a, b) =>
      (b.lastReadAt ?? b.createdAt) - (a.lastReadAt ?? a.createdAt) ||
      a.title.localeCompare(b.title),
  );
}

/**
 * Marks a section as read *now*. Called once the reader has had the article
 * open for ten seconds of visible time -- see `ReadStamp`.
 */
export function stampLastRead(sectionId: string): boolean {
  const result = db
    .update(sections)
    .set({ lastReadAt: Math.floor(Date.now() / 1000) })
    .where(eq(sections.id, sectionId))
    .run();
  return result.changes > 0;
}
