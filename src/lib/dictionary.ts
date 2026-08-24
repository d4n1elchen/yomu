import { and, asc, desc, eq, like, or, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { matchCandidates } from './dict/match.ts';
import {
  dictEntries,
  dictSenses,
  lexemes,
  sections,
  sentences,
  tokens,
  works,
} from '../db/schema.ts';

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
 * The Dictionary's default view, as one reusable condition: content words only.
 * The Library's per-article vocabulary tally counts the same set, so that the
 * two pages cannot print numbers that disagree.
 */
export const contentWord = sql`${lexemes.pos} not in ${[
  ...EXCLUDED_POS,
  ...FUNCTION_POS,
]}`;

/**
 * What counts as one word in the Dictionary listing.
 *
 * IPADIC's lemma keeps the spelling you wrote, so 分かる, 判る and 解る come back
 * as three lexemes -- three rows, three occurrence counts, for one word you
 * have met three times. JMdict is the only thing that knows they are the same
 * word, and the entry each of them matched is that answer. A word that matched
 * nothing falls back to standing alone, keyed on itself.
 *
 * This is a grouping and deliberately not an identity. Keying `lexeme` on the
 * matched entry would put the least reliable link in the chain -- 5 of 34
 * content words here are ambiguous -- underneath the data model, so a bad match
 * would pool two different words' occurrences instead of mislabelling one page,
 * and every improvement to matching would become a row merge rather than a
 * rewritten pointer.
 */
const wordGroup = sql`coalesce(${lexemes.dictEntryId}, ${lexemes.id})`;

/**
 * A word earns a place in the Dictionary by appearing in text somebody has
 * actually read. Occurrences inside unreviewed transcript sentences are
 * excluded by default: a transcription error tokenizes just as cleanly as real
 * Japanese, and the quiz should never test a word nobody said.
 */
const reviewed = sql`${sentences.needsReview} = 0`;

export interface DictionaryEntry {
  id: string;
  lemma: string;
  reading: string;
  pos: string;
  occurrences: number;
  workCount: number;
  /** The distinct inflected forms seen, which is the point of the grouping. */
  forms: string[];
}

export interface DictionaryQuery {
  pos?: string;
  q?: string;
  includeUnreviewed?: boolean;
  limit?: number;
}

export interface DictionaryPage {
  entries: DictionaryEntry[];
  /** Total matching entries, which may exceed the number returned. */
  total: number;
  facets: Array<{ pos: string; count: number }>;
}

/**
 * `ignorePos` drops both the explicit filter and the content-word default, so
 * the facet counts can still offer 助詞 and 助動詞 even though the default view
 * hides them.
 */
function filters(query: DictionaryQuery, opts: { ignorePos?: boolean } = {}) {
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

export function listDictionary(query: DictionaryQuery = {}): DictionaryPage {
  const limit = query.limit ?? 300;
  const where = filters(query);

  const scope = () =>
    db
      .select()
      .from(lexemes)
      .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
      .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
      .innerJoin(sections, eq(sections.id, sentences.sectionId));

  const groups = db
    .select({
      groupId: sql<string>`${wordGroup}`.as('group_id'),
      occurrences: sql<number>`count(${tokens.id})`.as('occurrences'),
      workCount: sql<number>`count(distinct ${sections.workId})`,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(where)
    .groupBy(sql`group_id`)
    .orderBy(desc(sql`occurrences`))
    .limit(limit)
    .all();

  const groupIds = groups.map((group) => group.groupId);

  // The lexemes behind those groups. The one seen most often speaks for the
  // group: 分かる should head the row rather than 解る because that is the
  // spelling actually read, and JMdict's own headword is no help here -- it
  // offers 迄 for まで and 積もり for つもり.
  const members =
    groupIds.length === 0
      ? []
      : db
          .select({
            groupId: sql<string>`${wordGroup}`.as('group_id'),
            id: lexemes.id,
            lemma: lexemes.lemma,
            reading: lexemes.reading,
            pos: lexemes.pos,
            occurrences: sql<number>`count(${tokens.id})`.as('member_count'),
          })
          .from(lexemes)
          .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
          .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
          .innerJoin(sections, eq(sections.id, sentences.sectionId))
          .where(and(where, sql`${wordGroup} in ${groupIds}`))
          .groupBy(lexemes.id)
          .all();

  const leadByGroup = new Map<string, (typeof members)[number]>();
  const groupOfLexeme = new Map<string, string>();
  for (const member of members) {
    groupOfLexeme.set(member.id, member.groupId);
    const best = leadByGroup.get(member.groupId);
    if (
      !best ||
      member.occurrences > best.occurrences ||
      (member.occurrences === best.occurrences && member.lemma < best.lemma)
    ) {
      leadByGroup.set(member.groupId, member);
    }
  }

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

  const formsByGroup = new Map<string, Set<string>>();
  for (const row of formRows) {
    const groupId = groupOfLexeme.get(row.lexemeId);
    if (groupId === undefined) continue;
    let forms = formsByGroup.get(groupId);
    if (!forms) formsByGroup.set(groupId, (forms = new Set()));
    forms.add(row.surface);
  }

  const counted = db
    .select({ n: sql<number>`count(distinct ${wordGroup})` })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(where)
    .get();

  const facets = db
    .select({
      pos: lexemes.pos,
      count: sql<number>`count(distinct ${wordGroup})`.as('count'),
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(filters(query, { ignorePos: true }))
    .groupBy(lexemes.pos)
    .orderBy(desc(sql`count`))
    .all();

  const entries: DictionaryEntry[] = [];
  for (const group of groups) {
    const lead = leadByGroup.get(group.groupId);
    if (!lead) continue;
    entries.push({
      id: lead.id,
      lemma: lead.lemma,
      reading: lead.reading,
      pos: lead.pos,
      occurrences: group.occurrences,
      workCount: group.workCount,
      forms: [...(formsByGroup.get(group.groupId) ?? [])],
    });
  }
  // The SQL ordering ranks groups; the lemma tiebreak needs the representative,
  // which is only known once the members have been read.
  entries.sort((a, b) => b.occurrences - a.occurrences || a.lemma.localeCompare(b.lemma));

  return { entries, total: counted?.n ?? 0, facets };
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

/** Another entry that fitted the same lemma, reading and grammar. */
export interface Alternative {
  entryId: string;
  headword: string;
  reading: string;
  /** JMdict's first gloss -- enough to recognise the word, or rule it out. */
  glossEn: string;
  glossZh: string | null;
}

/** What JMdict knows about the word, when it was matched to an entry. */
export interface DictionaryMeaning {
  entryId: string;
  /** JMdict's own headword and reading, which need not equal the analyzer's. */
  headword: string;
  reading: string;
  /** nf band 1-48, or null for rarer than the top 24,000 words. */
  band: number | null;
  /** JMdict marks the word common, whether or not the corpus ranked it. */
  common: boolean;
  /** Whether the reading took part in the match, or only the lemma did. */
  match: string | null;
  senses: Array<{ zh: string | null; en: string }>;
  /**
   * The entries that also fitted, minus the one taken, and minus any whose
   * meaning is the same as the one taken -- 三 competes with another 三 and
   * つもり with 心算, and warning about a choice the reader cannot see the
   * effect of is noise. What is left is a genuine alternative reading of the
   * word.
   */
  alternatives: Alternative[];
}

export interface DictionaryDetail {
  entry: Omit<DictionaryEntry, 'occurrences' | 'workCount' | 'forms'>;
  occurrences: Occurrence[];
  forms: string[];
  /** Null when nothing in JMdict matched -- a name, or a mis-segmentation. */
  meaning: DictionaryMeaning | null;
}

/**
 * Enough to recognise a wrong pick, not so many that the list is scenery.
 * Survivors arrive best-first, so a cap keeps the plausible alternatives and
 * drops the tail -- いる otherwise trails 沃る and 率る, both of which JMdict
 * marks poetical.
 */
const MAX_ALTERNATIVES = 3;

/**
 * The part of a gloss that decides whether two entries mean the same thing.
 *
 * JMdict's leading sense often restates itself -- one 三 glosses "three; 3"
 * and another simply "three" -- so comparing the whole string calls them
 * different and warns about a choice with no visible consequence.
 */
function sameMeaning(gloss: string): string {
  return gloss.split(';')[0]!.trim().toLowerCase();
}

/** The first sense of an entry, which is the one JMdict leads with. */
function leadGloss(entryId: string) {
  return db
    .select({ en: dictSenses.glossEn, zh: dictSenses.glossZh })
    .from(dictSenses)
    .where(eq(dictSenses.entryId, entryId))
    .orderBy(asc(dictSenses.orderIndex))
    .limit(1)
    .get();
}

/**
 * The entries that fitted but were not taken, worth showing to the reader.
 *
 * Two are dropped: the entry actually linked, and any whose leading gloss reads
 * the same as it. JMdict carries near-duplicate entries -- two 三 both meaning
 * "three", 積もり and 心算 both "intention; plan" -- and flagging a choice with
 * no visible consequence trains the reader to ignore the flag that matters.
 */
function alternativesFor(row: {
  lemma: string;
  reading: string;
  pos: string;
  posDetail: string | null;
  conjugationType: string | null;
  entryId: string | null;
}): Alternative[] {
  if (row.entryId === null) return [];

  const found = matchCandidates(row.lemma, row.reading, row);
  if (!found || found.survivors.length < 2) return [];

  const taken = sameMeaning(leadGloss(row.entryId)?.en ?? '');
  const alternatives: Alternative[] = [];

  for (const entryId of found.survivors) {
    if (alternatives.length >= MAX_ALTERNATIVES) break;
    if (entryId === row.entryId) continue;
    const gloss = leadGloss(entryId);
    if (!gloss || sameMeaning(gloss.en) === taken) continue;
    const entry = db
      .select({ headword: dictEntries.headword, reading: dictEntries.reading })
      .from(dictEntries)
      .where(eq(dictEntries.id, entryId))
      .get();
    if (!entry) continue;
    alternatives.push({
      entryId,
      headword: entry.headword,
      reading: entry.reading,
      glossEn: gloss.en,
      glossZh: gloss.zh,
    });
  }
  return alternatives;
}

/**
 * Every place a dictionary form has occurred. This is a single indexed lookup
 * on token.lexemeId -- the payoff for storing tokens normalized at import.
 */
export function getDictionaryEntry(
  lexemeId: string,
  options: { includeUnreviewed?: boolean } = {},
): DictionaryDetail | null {
  const row = db
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      posDetail: lexemes.posDetail,
      conjugationType: lexemes.conjugationType,
      entryId: lexemes.dictEntryId,
      match: lexemes.dictMatch,
      headword: dictEntries.headword,
      entryReading: dictEntries.reading,
      band: dictEntries.freqBand,
      common: dictEntries.common,
    })
    .from(lexemes)
    .leftJoin(dictEntries, eq(dictEntries.id, lexemes.dictEntryId))
    .where(eq(lexemes.id, lexemeId))
    .get();

  if (!row) return null;

  const entry = {
    id: row.id,
    lemma: row.lemma,
    reading: row.reading,
    pos: row.pos,
  };

  const meaning: DictionaryMeaning | null =
    row.entryId === null
      ? null
      : {
          entryId: row.entryId,
          headword: row.headword ?? row.lemma,
          reading: row.entryReading ?? '',
          band: row.band,
          common: row.common ?? false,
          match: row.match,
          senses: db
            .select({ zh: dictSenses.glossZh, en: dictSenses.glossEn })
            .from(dictSenses)
            .where(eq(dictSenses.entryId, row.entryId))
            .orderBy(asc(dictSenses.orderIndex))
            .all(),
          alternatives: alternativesFor(row),
        };

  // Every lexeme the listing folded into this row, so the occurrence list and
  // the count on the row cannot disagree.
  const groupMembers = db
    .select({ id: lexemes.id })
    .from(lexemes)
    .where(
      row.entryId === null
        ? eq(lexemes.id, lexemeId)
        : eq(lexemes.dictEntryId, row.entryId),
    )
    .all()
    .map((member) => member.id);

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
        sql`${tokens.lexemeId} in ${groupMembers}`,
        options.includeUnreviewed ? undefined : reviewed,
      ),
    )
    .orderBy(asc(works.createdAt), asc(sections.orderIndex), asc(sentences.orderIndex))
    .all();

  return {
    entry,
    occurrences,
    forms: [...new Set(occurrences.map((o) => o.surface))],
    meaning,
  };
}
