import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { lexemes, sections, sentences, tokens, works } from '../db/schema.ts';

/**
 * Symbols and punctuation are tokens but not vocabulary. Everything else --
 * including particles and auxiliaries -- stays, because they are exactly the
 * things a learner asks about.
 */
const EXCLUDED_POS = ['記号'];

/**
 * Particles and auxiliaries are the most frequent tokens in any Japanese text,
 * so ordering by raw count buries every real word under た/で/は/を. They are
 * hidden from the default view and reachable by picking their part of speech,
 * which keeps the index useful as a vocabulary list without pretending they
 * are not part of the language.
 */
const FUNCTION_POS = ['助詞', '助動詞'];

/**
 * A word earns a place in the Library by appearing in text somebody has
 * actually read. Occurrences inside unreviewed transcript sentences are
 * excluded by default: a transcription error tokenizes just as cleanly as real
 * Japanese, and the quiz should never test a word nobody said.
 */
const reviewed = sql`${sentences.needsReview} = 0`;

export interface LibraryEntry {
  id: string;
  lemma: string;
  reading: string;
  pos: string;
  occurrences: number;
  workCount: number;
  /** The distinct inflected forms seen, which is the point of the grouping. */
  forms: string[];
}

export interface LibraryQuery {
  pos?: string;
  q?: string;
  includeUnreviewed?: boolean;
  limit?: number;
}

export interface LibraryPage {
  entries: LibraryEntry[];
  /** Total matching entries, which may exceed the number returned. */
  total: number;
  facets: Array<{ pos: string; count: number }>;
}

/**
 * `ignorePos` drops both the explicit filter and the content-word default, so
 * the facet counts can still offer 助詞 and 助動詞 even though the default view
 * hides them.
 */
function filters(query: LibraryQuery, opts: { ignorePos?: boolean } = {}) {
  const clauses = [
    sql`${lexemes.pos} not in ${EXCLUDED_POS}`,
    query.includeUnreviewed ? undefined : reviewed,
    opts.ignorePos
      ? undefined
      : query.pos
        ? eq(lexemes.pos, query.pos)
        : sql`${lexemes.pos} not in ${FUNCTION_POS}`,
    query.q
      ? or(
          like(lexemes.lemma, `%${query.q}%`),
          like(lexemes.reading, `%${query.q}%`),
        )
      : undefined,
  ].filter(Boolean);
  return and(...clauses);
}

export function listLibrary(query: LibraryQuery = {}): LibraryPage {
  const limit = query.limit ?? 300;
  const where = filters(query);

  const rows = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      occurrences: sql<number>`count(${tokens.id})`.as('occurrences'),
      workCount: sql<number>`count(distinct ${sections.workId})`,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(where)
    .groupBy(lexemes.id)
    .orderBy(desc(sql`occurrences`), asc(lexemes.lemma))
    .limit(limit)
    .all();

  // Distinct surfaces, fetched separately rather than with GROUP_CONCAT so
  // that a form containing a comma cannot corrupt the split.
  const formRows = db
    .selectDistinct({ lexemeId: tokens.lexemeId, surface: tokens.surface })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(where)
    .all();

  const formsByLexeme = new Map<string, string[]>();
  for (const row of formRows) {
    const list = formsByLexeme.get(row.lexemeId);
    if (list) list.push(row.surface);
    else formsByLexeme.set(row.lexemeId, [row.surface]);
  }

  const counted = db
    .select({ n: sql<number>`count(distinct ${lexemes.id})` })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(where)
    .get();

  const facets = db
    .select({
      pos: lexemes.pos,
      count: sql<number>`count(distinct ${lexemes.id})`.as('count'),
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(filters(query, { ignorePos: true }))
    .groupBy(lexemes.pos)
    .orderBy(desc(sql`count`))
    .all();

  return {
    entries: rows.map((row) => ({
      ...row,
      forms: formsByLexeme.get(row.id) ?? [],
    })),
    total: counted?.n ?? 0,
    facets,
  };
}

export interface Occurrence {
  tokenId: string;
  surface: string;
  /** Offsets into `sentenceText`, for highlighting the word in place. */
  charStart: number;
  charEnd: number;
  sentenceId: string;
  sentenceText: string;
  needsReview: boolean;
  sectionId: string;
  sectionTitle: string | null;
  workTitle: string;
}

export interface LibraryDetail {
  entry: Omit<LibraryEntry, 'occurrences' | 'workCount' | 'forms'>;
  occurrences: Occurrence[];
  forms: string[];
}

/**
 * Every place a dictionary form has occurred. This is a single indexed lookup
 * on token.lexemeId -- the payoff for storing tokens normalized at import.
 */
export function getLibraryEntry(
  lexemeId: string,
  options: { includeUnreviewed?: boolean } = {},
): LibraryDetail | null {
  const entry = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
    })
    .from(lexemes)
    .where(eq(lexemes.id, lexemeId))
    .get();

  if (!entry) return null;

  const occurrences = db
    .select({
      tokenId: tokens.id,
      surface: tokens.surface,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
      sentenceId: sentences.id,
      sentenceText: sentences.text,
      needsReview: sentences.needsReview,
      sectionId: sections.id,
      sectionTitle: sections.title,
      workTitle: works.title,
    })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .innerJoin(works, eq(works.id, sections.workId))
    .where(
      and(
        eq(tokens.lexemeId, lexemeId),
        options.includeUnreviewed ? undefined : reviewed,
      ),
    )
    .orderBy(asc(works.createdAt), asc(sections.orderIndex), asc(sentences.orderIndex))
    .all();

  return {
    entry,
    occurrences,
    forms: [...new Set(occurrences.map((o) => o.surface))],
  };
}
