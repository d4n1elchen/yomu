import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  primaryKey,
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
    /**
     * When homograph resolution finished. Null means it has not, and the section
     * is NOT readable yet -- the Library greys the row and the reader turns it
     * away.
     *
     * Gated because resolution moves `lexeme.dictEntryId`, and that column is
     * what the Dictionary groups on, what `getDictionaryEntry` collects members
     * by, and what the article's sense map is keyed on. Reading an article whose
     * links are still moving would show a word under one entry and then another.
     * Translation gates nothing by contrast: it only fills `glossZh`, so a card
     * gains Chinese and nothing relocates.
     *
     * Deliberately shaped like `tokenizedAt` -- a nullable stamp for "this stage
     * is finished", not a status string that could disagree with the rows.
     */
    resolvedAt: integer('resolved_at'),
    /**
     * How many ambiguous lexemes this section's import handed the resolver, and
     * how many it has got through. Only for the Library's progress readout.
     *
     * Counters rather than a derived count because "done" is not visible in the
     * lexeme rows: a candidate set whose glosses all agree is skipped without
     * ever being asked, and stays `dictResolver is null` exactly like one that
     * was never reached. Deriving progress would report those as outstanding
     * forever.
     */
    resolveTotal: integer('resolve_total').notNull().default(0),
    resolveDone: integer('resolve_done').notNull().default(0),
    /**
     * Stamped after ten seconds of reading, with the timer paused while the tab
     * is hidden. On `section` rather than `work` because a book needs to know
     * which chapter you were last in; the Library row shows the most recent
     * across a work's sections.
     */
    lastReadAt: integer('last_read_at'),
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
    /**
     * Whether this sentence opens a paragraph. Segmentation breaks on both 。 and
     * newlines, but only a newline is a paragraph boundary; without this the
     * reader flows every sentence onto its own line. Defaults true so a sentence
     * from before this column keeps its own line rather than merging into the
     * one before it.
     */
    paragraphStart: integer('paragraph_start', { mode: 'boolean' })
      .notNull()
      .default(true),
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
    /**
     * IPADIC's finer grammar, carried here so that matching can use it.
     *
     * Deliberately NOT part of the identity key above. 勉強 is 名詞-一般 in one
     * sentence and 名詞-サ変接続 in the next, and keying on the detail would
     * file it as two Dictionary entries -- the exact splitting the lemma key
     * exists to prevent. These are hints about a word, not part of what makes
     * it that word, so first writer wins and nothing re-files.
     *
     * `posDetail` is `pos_detail_1`; `conjugationType` is `conjugated_type`.
     * Between them they separate 居る (`v1`) from 入る (`v5r`) and the honorific
     * さん (`suf`) from 三 (`num`) -- homographs sharing a reading, which
     * nothing else in the data can tell apart.
     */
    posDetail: text('pos_detail'),
    conjugationType: text('conjugation_type'),
    /**
     * The JMdict entry this word was matched to, or null when nothing matched.
     * Null is not a failure state to be cleaned up: unmatched words are mostly
     * names and mis-segmentations, and are marked hard precisely because
     * nothing vouches for them.
     */
    dictEntryId: text('dict_entry_id').references(() => dictEntries.id),
    /**
     * How the match was made, because the three are not equally trustworthy:
     *
     * - 'lemma_reading'       one entry matched on both. The clean case.
     * - 'lemma_reading_multi' several survived lemma, reading AND grammar, and
     *                         the commonest was taken. Nothing available tells
     *                         them apart, so the senses shown may be the other
     *                         word's.
     * - 'lemma'               the reading matched nothing, so the lemma went
     *                         alone and may have picked the wrong homograph --
     *                         along with the wrong word's frequency band.
     *
     * Recorded rather than inferred, so a bad band or a wrong sense can be
     * traced instead of guessed at. See `MatchKind` in `src/lib/dict/match.ts`.
     */
    dictMatch: text('dict_match'),
    /**
     * The model that resolved a `lemma_reading_multi` link, when one did. Null
     * means the deterministic pick stands -- the commonest surviving entry.
     *
     * Resolution is the model choosing among entries nothing in the data can
     * separate -- 成る "to become" over 生る "to bear fruit", both `v5r,vi`, both
     * common, frequency pointing the wrong way. It fires only on
     * `lemma_reading_multi`, never on a clean `lemma_reading`, so a trustworthy
     * match is never second-guessed. Recorded like `dictSense.glossModel`: to
     * keep a model-chosen link distinguishable from a computed one, and
     * re-runnable later. A full relink clears it along with the link it
     * annotates, so it never outlives the pick it described.
     */
    dictResolver: text('dict_resolver'),
    createdAt: integer('created_at')
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex('lexeme_key_idx').on(t.dictionary, t.lemma, t.reading, t.pos),
    index('lexeme_dict_idx').on(t.dictEntryId),
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
    // The Dictionary's core query: every occurrence of a dictionary form.
    index('token_lexeme_idx').on(t.lexemeId),
    index('token_sentence_idx').on(t.sentenceId, t.orderIndex),
  ],
);

/**
 * JMdict, imported whole. Entries keep their JMdict id verbatim, which is what
 * lets the simplified JSON (structure, glosses) and the original XML
 * (frequency bands, which the JSON conversion drops) be joined with no
 * matching work at all.
 */
export const dictEntries = sqliteTable(
  'dict_entry',
  {
    /** JMdict's `ent_seq`. Not generated here -- it is the join key. */
    id: text('id').primaryKey(),
    /**
     * nf01-nf48 stored as 1-48: which set of 500 words by corpus frequency the
     * entry falls in, so 1 is the commonest 500. Null means rarer than the top
     * 24,000, which is not missing data -- it is itself the difficulty signal
     * the reader's slider reads.
     */
    freqBand: integer('freq_band'),
    /**
     * jmdict-simplified's `common` flag, which is true when JMdict gave any of
     * the entry's forms a priority tag (ichi1, spec1, gai1, news1...).
     *
     * It cannot drive the slider -- it is one bit, and says yes to most real
     * reading vocabulary. It is here as a *floor* under `freqBand`, which is a
     * different question. `nf` ranks come from a newspaper corpus, and 7,726
     * entries JMdict marks common were never ranked by it: 本 carries `ichi1`
     * and no `nf` at all. Without this, every one of those words would look
     * rarer than the 24,000th and be marked hard.
     */
    common: integer('common', { mode: 'boolean' }).notNull().default(false),
    /** The form to print as the headword. Equals `reading` for kana-only words. */
    headword: text('headword').notNull(),
    /** Hiragana, always -- see `dictForms` for why that conversion is deliberate. */
    reading: text('reading').notNull(),
  },
  (t) => [index('dict_entry_band_idx').on(t.freqBand)],
);

/**
 * Every (written form, reading) pair an entry can be looked up by -- the
 * cross product of its kanji and kana forms, respecting JMdict's
 * `appliesToKanji` so that a reading is never paired with a spelling it does
 * not belong to.
 *
 * This exists so that matching a lexeme is one indexed query against the
 * database rather than a pass over the 118 MB source file. Importing a new
 * article creates new lexemes that need linking, and that must not require the
 * download to still be on disk.
 *
 * `reading` is hiragana on both sides of the join by construction: kuromoji
 * reports katakana, JMdict writes hiragana except for loanwords it lists in
 * katakana, so both are folded to hiragana rather than either being trusted.
 */
export const dictForms = sqliteTable(
  'dict_form',
  {
    entryId: text('entry_id')
      .notNull()
      .references(() => dictEntries.id, { onDelete: 'cascade' }),
    /** The written form: a kanji spelling, or the kana itself for kana words. */
    text: text('text').notNull(),
    reading: text('reading').notNull(),
  },
  (t) => [
    // Also the match index: (text, reading) is its leftmost prefix, and
    // (text) alone serves the reading-less fallback.
    primaryKey({ columns: [t.text, t.reading, t.entryId] }),
  ],
);

/**
 * A JMdict sense, in JMdict's own order -- which is by commonness, so the first
 * sense is the one to lead with and nothing has to pick.
 */
export const dictSenses = sqliteTable(
  'dict_sense',
  {
    id: text('id').primaryKey(),
    entryId: text('entry_id')
      .notNull()
      .references(() => dictEntries.id, { onDelete: 'cascade' }),
    orderIndex: integer('order_index').notNull(),
    /** JMdict's own POS tags (n, v5r, adj-i), not IPADIC's. Comma-joined. */
    pos: text('pos').notNull(),
    /** JMdict's English glosses for this sense, joined with '; '. */
    glossEn: text('gloss_en').notNull(),
    /**
     * Traditional Chinese, translated from `glossEn` rather than defined from
     * scratch: given a real sense to render the model can mistranslate, but it
     * cannot invent a meaning the dictionary never had.
     *
     * Null until translated, and `gloss_zh is null` IS the work queue -- no
     * separate table. An unreachable model leaves nulls that the next import
     * picks up, and reading never blocks on it.
     */
    glossZh: text('gloss_zh'),
    /**
     * The model that wrote `glossZh`. A mistranslation is invisible in a way a
     * wrong reading is not, so provenance is what makes re-translating a subset
     * possible later -- same reason `section.analyzerId` exists.
     */
    glossModel: text('gloss_model'),
  },
  (t) => [
    index('dict_sense_entry_idx').on(t.entryId, t.orderIndex),
    // The Phase C translation queue.
    index('dict_sense_untranslated_idx').on(t.glossZh),
  ],
);


/**
 * The words you have picked out to learn -- 生詞.
 *
 * Presence is the state: a row means the word is on the list, and removing it
 * deletes the row. There is no flag to keep consistent with the row's existence.
 *
 * **This does not affect what the reader underlines.** Marking is purely
 * statistical -- `isHardWord` asks JMdict whether a word is common and nothing
 * else -- and that separation is deliberate. It keeps the dashed line meaning
 * one thing, and it is what makes this reversible: a word you mark stays
 * underlined, so it stays reachable and you can unmark it where you marked it.
 * An earlier design had "known" suppress the underline, which made a marked word
 * untappable and the action one-way.
 *
 * Keyed on `lexeme` rather than on the matched entry, for the same reason the
 * comment on `lexeme.dictEntryId` gives: the link is the least reliable thing in
 * the chain and must not sit underneath user state. Reading resolves across the
 * Dictionary's group instead, so 見る and 観る are one word here exactly as they
 * are one row there.
 *
 * The SRS columns are null until there is a quiz. A word on this list is
 * precisely a word a schedule would apply to, which is why they share a table
 * rather than waiting for one of their own.
 */
export const userLexemeState = sqliteTable('user_lexeme_state', {
  lexemeId: text('lexeme_id')
    .primaryKey()
    .references(() => lexemes.id, { onDelete: 'cascade' }),
  addedAt: integer('added_at')
    .notNull()
    .default(sql`(unixepoch())`),
  /** 0 until a quiz grades it. Reserved for SRS; nothing writes it yet. */
  familiarity: integer('familiarity').notNull().default(0),
  lastReviewedAt: integer('last_reviewed_at'),
  srsDue: integer('srs_due'),
});

/*
 * ---------------------------------------------------------------------------
 * Designed for, deliberately not created yet.
 * ---------------------------------------------------------------------------
 *
 * Quiz scheduling, on `user_lexeme_state` above. The list of words to learn is
 * built; what to ask and when is not. `familiarity`, `lastReviewedAt` and
 * `srsDue` are there for it.
 *
 * The sketch here used to include `markedHard`, for forcing the underline onto a
 * word JMdict calls common. Dropped: underlining is purely statistical and
 * nothing overrides it, which is what keeps the dashed line meaning one thing.
 *
 * ---------------------------------------------------------------------------
 * Grammar: deferred, and the earlier design was wrong.
 * ---------------------------------------------------------------------------
 *
 * An earlier sketch here had grammar entries recorded during Q&A, with the
 * agent deciding whether a point was new. That does not work: vocabulary
 * dedups on a natural key the analyzer derives mechanically, while a model
 * inventing names for grammar points produces near-duplicates that only become
 * visible once the collection is large enough to matter.
 *
 * Grammar needs a natural key before it can work the way vocabulary does --
 * either token-stream patterns matched deterministically as you read, or a
 * fixed inventory the model may only select from, never name. Undecided, and
 * deliberately not built until there is real reading to ground it in.
 *
 * Q&A is not the mechanism of record. It streams an answer and keeps nothing.
 *
 * Note: orphaned lexemes are never garbage-collected. Editing a sentence drops
 * its tokens, which can take a lexeme's occurrence count to zero, but
 * user_lexeme_state may reference it and you may well have learned that word.
 */
