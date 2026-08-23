import { asc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { lexemes, sections, sentences, tokens, works } from '../db/schema.ts';
import { contentWord } from './dictionary.ts';

export interface ArticleToken {
  id: string;
  sentenceId: string;
  charStart: number;
  charEnd: number;
  surface: string;
  /** Katakana reading of this surface, or null when the analyzer has none. */
  reading: string | null;
  lemma: string;
  lemmaReading: string;
  pos: string;
}

export interface ArticleSentence {
  id: string;
  text: string;
  needsReview: boolean;
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
      sentenceOrder: sentences.orderIndex,
      tokenId: tokens.id,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
      surface: tokens.surface,
      reading: tokens.reading,
      lemma: lexemes.lemma,
      lemmaReading: lexemes.reading,
      pos: lexemes.pos,
    })
    .from(sentences)
    .leftJoin(tokens, eq(tokens.sentenceId, sentences.id))
    .leftJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
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
        tokens: [],
      };
      bySentence.set(row.sentenceId, sentence);
    }
    // Left join: a sentence with no tokens still yields one row, with nulls.
    if (row.tokenId === null) continue;
    sentence.tokens.push({
      id: row.tokenId,
      sentenceId: row.sentenceId,
      charStart: row.charStart!,
      charEnd: row.charEnd!,
      surface: row.surface!,
      reading: row.reading,
      lemma: row.lemma!,
      lemmaReading: row.lemmaReading!,
      pos: row.pos!,
    });
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

    summaries.push({
      workId: work.workId,
      title: work.title,
      author: work.author,
      sectionId: entry.id,
      createdAt: work.createdAt,
      lastReadAt: lastRead,
      vocabCount: vocabByWork.get(work.workId) ?? 0,
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
