import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { lexemes, sections, sentences, tokens, works } from '../db/schema.ts';

export interface LessonToken {
  id: string;
  charStart: number;
  charEnd: number;
  surface: string;
  /** Katakana reading of this surface, or null when the analyzer has none. */
  reading: string | null;
  lemma: string;
  lemmaReading: string;
  pos: string;
}

export interface LessonSentence {
  id: string;
  text: string;
  needsReview: boolean;
  tokens: LessonToken[];
}

export interface Lesson {
  sectionId: string;
  sectionTitle: string | null;
  workId: string;
  workTitle: string;
  author: string | null;
  origin: string;
  editState: string;
  sentences: LessonSentence[];
}

export function getLesson(sectionId: string): Lesson | null {
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

  const bySentence = new Map<string, LessonSentence>();
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
      charStart: row.charStart!,
      charEnd: row.charEnd!,
      surface: row.surface!,
      reading: row.reading,
      lemma: row.lemma!,
      lemmaReading: row.lemmaReading!,
      pos: row.pos!,
    });
  }

  return { ...head, sentences: [...bySentence.values()] };
}

export interface WorkSummary {
  workId: string;
  title: string;
  author: string | null;
  sectionId: string;
  createdAt: number;
}

/** The library index. One row per section, which for a pasted article is one row. */
export function listWorks(): WorkSummary[] {
  return db
    .select({
      workId: works.id,
      title: works.title,
      author: works.author,
      sectionId: sections.id,
      createdAt: works.createdAt,
    })
    .from(works)
    .innerJoin(sections, eq(sections.workId, works.id))
    .orderBy(asc(works.createdAt), asc(sections.orderIndex))
    .all();
}
