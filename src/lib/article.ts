import { asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
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
import type { RubySpan } from './text/ruby.ts';
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
  /**
   * The text's own furigana, offsets into `text`. Optional only because a
   * chapter downloaded before ruby was kept is stored without it.
   */
  ruby?: RubySpan[];
}

export interface ArticleChapter {
  sectionId: string;
  title: string | null;
  /**
   * The chapter this is a numbered part of, or null for a chapter. A chapter
   * with parts is only their heading: it has no sentences and is never opened.
   *
   * Optional only because a chapter downloaded before nesting existed is stored
   * without it; everything the server builds carries it.
   */
  parentId?: string | null;
  /** False while homograph resolution is still moving this section's links. */
  readable: boolean;
}

/**
 * The name a part goes by outside the contents: `１　エコーノイズ（２）`.
 *
 * Inside the contents a part sits under its chapter and `２` is enough. Anywhere
 * it stands alone -- the reader's heading, a Dictionary occurrence, the offline
 * shelf -- a bare number says nothing, so the chapter comes with it.
 */
export function sectionLabel(
  chapterTitle: string | null,
  title: string | null,
): string | null {
  if (chapterTitle === null) return title;
  return title === null ? chapterTitle : `${chapterTitle}（${title}）`;
}

/** The sections a reader opens: a heading whose chapter was split has none of its own. */
export const leafSection = sql`not exists (
  select 1 from ${sections} as child where child.parent_id = ${sections.id}
)`;

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
  /**
   * Every section of this work, in reading order.
   *
   * A book imported from an EPUB is one Library row with fifteen chapters
   * behind it, and the Library links to exactly one of them -- so without a
   * list carried into the reader, chapter seven is unreachable. A pasted
   * article has a single entry here and the reader draws no navigation for it.
   */
  chapters: ArticleChapter[];
  /**
   * The sentence you were at when you last scrolled this section, or null to
   * start at the top. See `section.progressSentenceId`.
   *
   * Optional only because a chapter downloaded before this existed is stored
   * without it; everything the server builds carries it.
   */
  progressSentenceId?: string | null;
}

export function getArticle(sectionId: string): Article | null {
  const parent = alias(sections, 'parent');
  const found = db
    .select({
      sectionId: sections.id,
      title: sections.title,
      chapterTitle: parent.title,
      origin: sections.origin,
      editState: sections.editState,
      progressSentenceId: sections.progressSentenceId,
      workId: works.id,
      workTitle: works.title,
      author: works.author,
    })
    .from(sections)
    .innerJoin(works, eq(works.id, sections.workId))
    .leftJoin(parent, eq(parent.id, sections.parentId))
    .where(eq(sections.id, sectionId))
    .get();

  if (!found) return null;
  const { title, chapterTitle, ...rest } = found;
  const head = { ...rest, sectionTitle: sectionLabel(chapterTitle, title) };

  const rows = db
    .select({
      sentenceId: sentences.id,
      sentenceText: sentences.text,
      needsReview: sentences.needsReview,
      paragraphStart: sentences.paragraphStart,
      ruby: sentences.ruby,
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
        ruby: parseRuby(row.ruby),
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

  const chapters = db
    .select({
      sectionId: sections.id,
      title: sections.title,
      parentId: sections.parentId,
      resolvedAt: sections.resolvedAt,
    })
    .from(sections)
    .where(eq(sections.workId, head.workId))
    .orderBy(asc(sections.orderIndex))
    .all()
    .map((row) => ({
      sectionId: row.sectionId,
      title: row.title,
      parentId: row.parentId,
      readable: row.resolvedAt !== null,
    }));

  return {
    ...head,
    vocabCount: vocab?.count ?? 0,
    sentences: [...bySentence.values()],
    senses,
    chapters,
    learning: learningGroupKeys(),
    dictionaryReady:
      db.select({ one: sql<number>`1` }).from(dictEntries).limit(1).get() !==
      undefined,
  };
}

/**
 * Removes a work and everything written from its text.
 *
 * Sections, sentences and tokens go with it, by the cascades already declared on
 * those tables. **Lexemes deliberately do not**, even when this deletes the last
 * token that referenced one. A lexeme is a word you have met, possibly one you
 * have marked as 生詞, and the schema is explicit that orphans are never
 * collected -- deleting an article must not quietly unlearn a word.
 *
 * The visible consequence: a word that appeared only in this article keeps its
 * row and its 生詞 mark, but drops out of the Dictionary's listings, which count
 * occurrences by joining tokens. It reappears whole the moment the word turns up
 * in something else you read.
 *
 * Returns false when the work is already gone, so a double submission is not an
 * error.
 */
export function deleteWork(workId: string): boolean {
  const result = db.delete(works).where(eq(works.id, workId)).run();
  return result.changes > 0;
}

export interface ArticleSummary {
  workId: string;
  title: string;
  author: string | null;
  /** The section a click opens: where you were last, else the first readable one. */
  sectionId: string;
  /**
   * Whether that section can be opened yet.
   *
   * Separate from `analysis`, and this is the distinction a book forced. Both
   * used to be the same fact, because a work was one section: it was either
   * resolved or it was not. An eighteen-chapter book resolves a chapter at a
   * time, so waiting for the last one to open the first would have meant
   * hundreds of model requests between importing a novel and reading any of it
   * -- while chapter one had been ready for minutes.
   *
   * The invariant that actually matters is per-section and unchanged: a section
   * is readable when its own links have stopped moving, which is what
   * `isReadable` enforces and what the reader turns a URL away on. Gating the
   * whole work on its slowest chapter was a Library display choice, not that
   * invariant.
   */
  readable: boolean;
  createdAt: number;
  /** Most recent read across the work's sections. Null until one is stamped. */
  lastReadAt: number | null;
  /**
   * How far through the work you are, 1-100, or null before any position has
   * been saved in it.
   *
   * Measured in sentences, and for a book it assumes chapters are read in
   * order: every chapter before the one the row opens counts as read, plus the
   * position inside that one. Reading out of order makes the figure wrong, but
   * tracking which chapters were actually finished is a second record nothing
   * else needs. Sentences rather than characters, because sentences are what
   * the position is kept in.
   */
  progress: number | null;
  /** Distinct content words, counted the way the Dictionary counts them. */
  vocabCount: number;
  /** Chapters. One for a pasted article, which is why the Library only prints it above one. */
  sectionCount: number;
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
      parentId: sections.parentId,
    })
    .from(sections)
    // Only what can be opened. A split chapter's heading has no sentences, is
    // stamped resolved the moment it is written, and would otherwise be the
    // "first readable chapter" an unread book opens on -- an empty page.
    .where(leafSection)
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

  // Each section's length, and how many of its sentences come at or before the
  // saved one. The position is joined by id and compared by order, so a
  // position whose sentence was merged away reads as no position at all.
  const positionRows = db
    .select({
      sectionId: sentences.sectionId,
      total: sql<number>`count(*)`,
      reached: sql<number>`coalesce(sum(${sentences.orderIndex} <= saved.order_index), 0)`,
    })
    .from(sentences)
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .leftJoin(
      sql`${sentences} as saved`,
      sql`saved.id = ${sections.progressSentenceId}`,
    )
    .groupBy(sentences.sectionId)
    .all();
  const positions = new Map(positionRows.map((r) => [r.sectionId, r]));

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
    // Resume where you left off. A work never opened starts at the first
    // chapter that is readable rather than at the first chapter: while a book is
    // still resolving, those differ, and pointing at a section the reader would
    // turn away is a link that goes nowhere. Falling back to the first keeps a
    // row that is still entirely unresolved pointing somewhere real.
    const entry =
      owned.find((s) => s.lastReadAt !== null && s.lastReadAt === lastRead) ??
      owned.find((s) => s.resolvedAt !== null) ??
      owned[0]!;

    // A work is still analysing while any of its sections is: a book becomes
    // readable when every chapter's links have settled, not the first.
    const unresolved = owned.filter((s) => s.resolvedAt === null);

    const length = (id: string) => positions.get(id)?.total ?? 0;
    const whole = owned.reduce((n, s) => n + length(s.id), 0);
    // Earlier chapters count only once the row opens where you last were. An
    // unread book opens at its first *readable* chapter, which is not the first
    // chapter while analysis is still running, and those were never read.
    const behind =
      entry.lastReadAt === null
        ? 0
        : owned
            .filter((s) => s.orderIndex < entry.orderIndex)
            .reduce((n, s) => n + length(s.id), 0);
    const read = behind + (positions.get(entry.id)?.reached ?? 0);
    // Nothing saved yet is no figure, not 0%: a row reading "0%" beside a work
    // you have plainly opened would look like a bug. Reaching chapter five shows
    // the four behind it even before you scroll.
    const progress =
      read === 0 || whole === 0 ? null : Math.max(1, Math.floor((read / whole) * 100));

    summaries.push({
      workId: work.workId,
      title: work.title,
      author: work.author,
      sectionId: entry.id,
      readable: entry.resolvedAt !== null,
      createdAt: work.createdAt,
      lastReadAt: lastRead,
      progress,
      vocabCount: vocabByWork.get(work.workId) ?? 0,
      // Chapters, not parts: the row says 共 16 章 for the book's sixteen,
      // however many numbered sections they split into.
      sectionCount: new Set(owned.map((s) => s.parentId ?? s.id)).size,
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

/**
 * Records where in a section you are. The sentence must belong to the section:
 * an id from another chapter would scroll nowhere, and a stale tab posting to the
 * wrong URL should be refused rather than stored.
 *
 * Deliberately separate from `stampLastRead`. That one waits ten visible seconds
 * so background tabs do not reorder the Library; this one only fires when you
 * scroll, which a background tab cannot do.
 */
export function saveProgress(sectionId: string, sentenceId: string): boolean {
  const result = db
    .update(sections)
    .set({ progressSentenceId: sentenceId })
    .where(
      sql`${sections.id} = ${sectionId} and exists (
        select 1 from ${sentences}
        where ${sentences.id} = ${sentenceId}
          and ${sentences.sectionId} = ${sectionId}
      )`,
    )
    .run();
  return result.changes > 0;
}

/** `sentence.ruby` as stored -- JSON triples -- back into spans. */
export function parseRuby(column: string | null): RubySpan[] {
  if (column === null) return [];
  return (JSON.parse(column) as Array<[number, number, string]>).map(
    ([start, end, reading]) => ({ start, end, reading }),
  );
}
