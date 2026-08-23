import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/**
 * Content is hierarchical: a novel is a `work` with many `section`s, an article is
 * a `work` with one. There is no separate "article" concept.
 *
 * Two ideas carry this schema:
 *
 * 1. A vocab occurrence needs no occurrence table -- the `token` row IS the
 *    occurrence. "Every place 食べる appeared" is one indexed query on
 *    token.lexemeId, with inflected forms already collapsed under the lemma.
 *    (Grammar occurrences are different: they are recorded during Q&A rather
 *    than derived from tokenization, so they get their own table. See below.)
 *
 * 2. The sentence is the unit of text, of edit, and of offset. Transcribed
 *    audio contains errors that get fixed while reading, so `sentence.text` is
 *    the source of truth and token offsets are relative to it. Editing one
 *    sentence re-derives only that sentence's tokens; every other sentence
 *    keeps its id, its tokens, and whatever Q&A is anchored to it.
 */

export const works = sqliteTable('work', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  author: text('author'),
  /** 'paste' | 'file' | 'url' | 'transcript' */
  sourceType: text('source_type').notNull(),
  sourceUrl: text('source_url'),
  language: text('language').notNull().default('ja'),
  createdAt: integer('created_at')
    .notNull()
    .default(sql`(unixepoch())`),
});

export const sections = sqliteTable(
  'section',
  {
    id: text('id').primaryKey(),
    workId: text('work_id')
      .notNull()
      .references(() => works.id, { onDelete: 'cascade' }),
    /** Self-reference gives chapter > subsection nesting. */
    parentId: text('parent_id'),
    /** Sparse (steps of 1000) so inserts do not renumber siblings. */
    orderIndex: integer('order_index').notNull(),
    title: text('title'),
    /** The original imported text. Immutable -- provenance only, never rendered. */
    sourceText: text('source_text'),
    /** 'text' | 'transcript' -- whether this content is inherently suspect. */
    origin: text('origin').notNull().default('text'),
    /** 'locked' | 'editable' | 'needs_review' */
    editState: text('edit_state').notNull().default('editable'),
    analyzerId: text('analyzer_id').notNull(),
    analyzerVersion: text('analyzer_version').notNull(),
    tokenizedAt: integer('tokenized_at'),
  },
  (t) => [index('section_work_idx').on(t.workId, t.parentId, t.orderIndex)],
);

export const sentences = sqliteTable(
  'sentence',
  {
    id: text('id').primaryKey(),
    sectionId: text('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    /**
     * Sparse (steps of 1000): correcting a transcript often splits or merges
     * sentences where the transcriber put the boundary in the wrong place.
     */
    orderIndex: integer('order_index').notNull(),
    /** SOURCE OF TRUTH. Editable. Token offsets are relative to this. */
    text: text('text').notNull(),
    /**
     * Bumped on every edit. Q&A and grammar anchors store the revision they
     * were written against, so a corrected sentence makes them detectably
     * stale instead of silently pointing at the wrong characters.
     */
    revision: integer('revision').notNull().default(0),
    /** Low-confidence transcript segment: not yet trustworthy as vocabulary. */
    needsReview: integer('needs_review', { mode: 'boolean' })
      .notNull()
      .default(false),
    /** Transcriber's per-segment confidence, when the engine reports one. */
    confidence: real('confidence'),
    /** Media timings, for playback sync once audio/video input lands. */
    startMs: integer('start_ms'),
    endMs: integer('end_ms'),
    editedAt: integer('edited_at'),
  },
  (t) => [index('sentence_section_idx').on(t.sectionId, t.orderIndex)],
);

export const lexemes = sqliteTable(
  'lexeme',
  {
    id: text('id').primaryKey(),
    /**
     * Namespaced by dictionary. IPADIC and UniDic disagree about lemmas, so
     * without this a dictionary swap would silently merge incompatible entries
     * with no way to tell which works need re-tokenizing.
     */
    dictionary: text('dictionary').notNull(),
    lemma: text('lemma').notNull(),
    /** Katakana reading of the lemma; empty when the analyzer knows none. */
    reading: text('reading').notNull(),
    pos: text('pos').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('lexeme_key_idx').on(t.dictionary, t.lemma, t.reading, t.pos),
  ],
);

export const tokens = sqliteTable(
  'token',
  {
    id: text('id').primaryKey(),
    sentenceId: text('sentence_id')
      .notNull()
      .references(() => sentences.id, { onDelete: 'cascade' }),
    lexemeId: text('lexeme_id')
      .notNull()
      .references(() => lexemes.id),
    orderIndex: integer('order_index').notNull(),
    /** Offsets RELATIVE TO sentence.text, not to the section. */
    charStart: integer('char_start').notNull(),
    charEnd: integer('char_end').notNull(),
    /** The inflected form as written. */
    surface: text('surface').notNull(),
    /** Reading of THIS surface, not of the lemma. Null for unknown words. */
    reading: text('reading'),
    /** JSON: pos_detail_1..3, conjugated_type, conjugated_form, word_type. */
    features: text('features').notNull(),
  },
  (t) => [
    // The Library's core query: every occurrence of a dictionary form.
    index('token_lexeme_idx').on(t.lexemeId),
    index('token_sentence_idx').on(t.sentenceId, t.orderIndex),
  ],
);

export const questions = sqliteTable(
  'question',
  {
    id: text('id').primaryKey(),
    sentenceId: text('sentence_id')
      .notNull()
      .references(() => sentences.id, { onDelete: 'cascade' }),
    /**
     * The revision this answer was written against. When the sentence is later
     * corrected, `sentenceRevision < sentence.revision` marks the answer stale
     * -- shown as such rather than deleted or silently mis-anchored.
     */
    sentenceRevision: integer('sentence_revision').notNull(),
    /** Optional sub-span of the sentence the reader asked about. */
    charStart: integer('char_start'),
    charEnd: integer('char_end'),
    prompt: text('prompt').notNull(),
    answer: text('answer').notNull(),
    /** Attribution, so an explanation can be judged by what produced it. */
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index('question_sentence_idx').on(t.sentenceId, t.createdAt)],
);

/*
 * ---------------------------------------------------------------------------
 * Designed for, deliberately not created yet.
 * ---------------------------------------------------------------------------
 *
 * user_lexeme_state(lexemeId pk, familiarity, markedHard, lastReviewedAt, srsDue)
 *   Hard-vocab marking and quiz scheduling are the same table. This is user
 *   state that changes independently of content, which is why it lives here
 *   and not on `token` (storing "hard" per token means rewriting every token
 *   when you learn a word) or on `lexeme`.
 *
 * grammar_entry(id, name, canonicalForm, summaryZhHant, status, createdAt)
 *   `status` is 'proposed' | 'confirmed'. The agent proposes; you confirm.
 *   Letting a local model freely decide "is this grammar point genuinely new"
 *   fragments the library into near-duplicates.
 *
 * grammar_occurrence(id, grammarEntryId, sentenceId, sentenceRevision,
 *                    questionId, note)
 *   Carries sentenceRevision for the same reason `question` does: when a
 *   sentence is corrected, anchor.sentenceRevision < sentence.revision marks
 *   the anchor stale, to be surfaced rather than deleted or mis-positioned.
 *   `questionId` records which question first produced the entry.
 *
 * Note: orphaned lexemes are never garbage-collected. Editing a sentence drops
 * its tokens, which can take a lexeme's occurrence count to zero, but
 * user_lexeme_state may reference it and you may well have learned that word.
 */
