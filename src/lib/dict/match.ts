import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  dictEntries,
  dictForms,
  dictSenses,
  lexemes,
  sentences,
  tokens,
} from '../../db/schema.ts';
import { contentWord } from '../dictionary.ts';
import { toHiragana } from '../text/kana.ts';
import { posAgrees, type AnalyzerPos } from './pos.ts';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * How a lexeme reached its entry. Stored, because these are not equally good.
 *
 * - `lemma_reading` -- one entry survived on lemma, reading and grammar. The
 *   trustworthy case.
 * - `lemma_reading_multi` -- several did, and the commonest was taken. Nothing
 *   available distinguishes them, so the senses shown may belong to the other.
 * - `lemma` -- the reading matched nothing, so the lemma went alone and may
 *   have picked the wrong homograph, along with the wrong word's band.
 */
export type MatchKind = 'lemma_reading' | 'lemma_reading_multi' | 'lemma';

export interface Match {
  entryId: string;
  kind: MatchKind;
}

export interface LinkStats {
  considered: number;
  /** Every match the reading took part in, ambiguous ones included. */
  lemmaReading: number;
  /** Of those, the ones where more than one entry survived. A subset. */
  ambiguous: number;
  lemmaOnly: number;
  unmatched: number;
}

/**
 * Where an unranked-but-common entry sorts among the ranked ones. Halfway down
 * the 48 bands: it should beat a rarity at nf40 and lose to anything in the
 * common half of the newspaper corpus.
 *
 * A sort key only -- nothing is stored, and no entry is given a band it has
 * not got.
 */
const COMMON_WITHOUT_RANK = 24;

/**
 * Homographs are why a match needs ordering at all: 人気 is にんき and ひとけ.
 * Preferring the commonest entry picks the word a reader is overwhelmingly
 * more likely to have met; the id is a stable tiebreak so the same word never
 * links two ways on two runs.
 *
 * The `common` arm is load-bearing rather than a nicety. 居る is `ichi1` with
 * no `nf` rank at all, so ordering on the band alone hands every いる in the
 * corpus to 射る, "to shoot", at nf26.
 */
const preference = sql`coalesce(
  ${dictEntries.freqBand},
  case when ${dictEntries.common} then ${COMMON_WITHOUT_RANK} else 999 end
)`;

/**
 * Enough candidates to see the whole homograph cluster before grammar narrows
 * it. さん draws twelve entries; nothing observed comes close to this.
 */
const CANDIDATE_LIMIT = 32;

function candidates(
  tx: Tx | typeof db,
  lemma: string,
  reading: string | null,
): string[] {
  return tx
    .select({ entryId: dictForms.entryId })
    .from(dictForms)
    .innerJoin(dictEntries, eq(dictEntries.id, dictForms.entryId))
    .where(
      reading === null
        ? eq(dictForms.text, lemma)
        : and(eq(dictForms.text, lemma), eq(dictForms.reading, reading)),
    )
    .orderBy(preference, asc(dictEntries.id))
    .limit(CANDIDATE_LIMIT)
    .all()
    .map((row) => row.entryId);
}

/** Every JMdict part-of-speech tag used by any sense of these entries. */
function tagsFor(
  tx: Tx | typeof db,
  entryIds: string[],
): Map<string, Set<string>> {
  const byEntry = new Map<string, Set<string>>();
  if (entryIds.length === 0) return byEntry;

  const rows = tx
    .select({ entryId: dictSenses.entryId, pos: dictSenses.pos })
    .from(dictSenses)
    .where(inArray(dictSenses.entryId, entryIds))
    .all();

  for (const row of rows) {
    let tags = byEntry.get(row.entryId);
    if (!tags) byEntry.set(row.entryId, (tags = new Set()));
    for (const tag of row.pos.split(',')) if (tag !== '') tags.add(tag);
  }
  return byEntry;
}

/**
 * Narrows a candidate list to the entries that could grammatically be this
 * token, keeping preference order.
 *
 * Falling back to the unnarrowed list when nothing agrees is deliberate. The
 * POS map is partial by design, and an entry whose senses are all tagged in a
 * way it does not cover must not be dropped -- matching coverage was 100% of
 * content words before grammar entered the picture, and must not regress in
 * exchange for sharper disambiguation.
 */
function narrow(
  ranked: string[],
  tags: Map<string, Set<string>>,
  analyzer: AnalyzerPos,
): string[] {
  const agreeing = ranked.filter((id) => posAgrees(analyzer, tags.get(id) ?? []));
  return agreeing.length > 0 ? agreeing : ranked;
}

/**
 * Matches one analyzer lexeme against JMdict on lemma, reading, and grammar.
 *
 * The reading is what disambiguates homographs, so it is tried first and alone
 * counts as a real match. kuromoji reports readings in katakana and JMdict
 * writes them in hiragana, so the fold happens here rather than being assumed
 * anywhere: both sides are hiragana by the time they meet.
 *
 * Grammar then settles what the reading could not. 入る and 居る are both いる,
 * both flagged common and neither ranked -- but one is `v5r` and the other
 * `v1`, and IPADIC knows which way the token conjugated.
 *
 * Falling back to the lemma alone recovers the cases where IPADIC and JMdict
 * disagree about a reading, at the cost of possibly picking the wrong
 * homograph -- which is why the caller records which of the two happened.
 */
export function matchLexeme(
  lemma: string,
  reading: string,
  analyzer: AnalyzerPos,
  tx: Tx | typeof db = db,
): Match | null {
  const found = matchCandidates(lemma, reading, analyzer, tx);
  return found === null ? null : { entryId: found.survivors[0]!, kind: found.kind };
}

/**
 * Every entry that survived lemma, reading and grammar, best first.
 *
 * `matchLexeme` takes the head of this list and throws the rest away, which is
 * the right thing for a link but the wrong thing to tell a reader. The
 * Dictionary shows the runners-up, so that when the pick is wrong -- なる takes
 * 生る "to bear fruit" over 成る "to become", and no signal in JMdict separates
 * them -- the right answer is visible one line below rather than hidden behind
 * an apology.
 *
 * Recomputed rather than stored: it is two indexed queries, and storing it
 * would mean a table that goes stale every time the matching rule improves.
 */
export function matchCandidates(
  lemma: string,
  reading: string,
  analyzer: AnalyzerPos,
  tx: Tx | typeof db = db,
): { survivors: string[]; kind: MatchKind } | null {
  if (lemma === '') return null;

  if (reading !== '') {
    const ranked = candidates(tx, lemma, toHiragana(reading));
    if (ranked.length > 0) {
      const survivors = narrow(ranked, tagsFor(tx, ranked), analyzer);
      return {
        survivors,
        kind: survivors.length > 1 ? 'lemma_reading_multi' : 'lemma_reading',
      };
    }
  }

  const ranked = candidates(tx, lemma, null);
  if (ranked.length === 0) return null;
  return { survivors: narrow(ranked, tagsFor(tx, ranked), analyzer), kind: 'lemma' };
}

/**
 * Links every lexeme that has not been matched yet.
 *
 * Called at the end of an article import, and by `scripts/import-jmdict.ts`
 * once the dictionary itself has changed. Only unlinked rows are touched, so
 * importing an article does not re-match the whole Dictionary; `relink` forces
 * the full pass for when the matching rule itself changes.
 *
 * Unmatched is left as null rather than recorded as a failure. An unmatched
 * word is usually a name or a mis-segmentation, and the reader marks it hard
 * precisely because nothing vouches for it.
 */
export function linkLexemes(
  tx: Tx | typeof db = db,
  options: { relink?: boolean } = {},
): LinkStats {
  const pending = tx
    .select({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      posDetail: lexemes.posDetail,
      conjugationType: lexemes.conjugationType,
    })
    .from(lexemes)
    .where(options.relink ? undefined : isNull(lexemes.dictEntryId))
    .all();

  const stats: LinkStats = {
    considered: pending.length,
    lemmaReading: 0,
    ambiguous: 0,
    lemmaOnly: 0,
    unmatched: 0,
  };

  for (const lexeme of pending) {
    const match = matchLexeme(lexeme.lemma, lexeme.reading, lexeme, tx);
    if (!match) {
      stats.unmatched++;
      if (options.relink) {
        tx.update(lexemes)
          .set({ dictEntryId: null, dictMatch: null })
          .where(eq(lexemes.id, lexeme.id))
          .run();
      }
      continue;
    }
    if (match.kind === 'lemma') {
      stats.lemmaOnly++;
    } else {
      stats.lemmaReading++;
      if (match.kind === 'lemma_reading_multi') stats.ambiguous++;
    }

    tx.update(lexemes)
      .set({ dictEntryId: match.entryId, dictMatch: match.kind })
      .where(eq(lexemes.id, lexeme.id))
      .run();
  }

  return stats;
}

/**
 * The match rate over the words the Dictionary actually lists.
 *
 * The denominator matters more than the number. Counting every lexeme buries
 * the answer: 。、「」！ are lexemes and none of them will ever be in JMdict, so
 * a raw rate measures how much punctuation the text had. This counts content
 * words that occur in a reviewed sentence -- `contentWord` and the needsReview
 * filter, the same two conditions the Dictionary page and the Library's vocab
 * column are built on, so the rate describes the words a reader will actually
 * be shown a card for.
 */
export function dictionaryMatchReport(tx: Tx | typeof db = db): LinkStats {
  const rows = tx
    .select({
      kind: lexemes.dictMatch,
      count: sql<number>`count(distinct ${lexemes.id})`,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(sql`${contentWord} and ${sentences.needsReview} = 0`)
    .groupBy(lexemes.dictMatch)
    .all();

  const of = (kind: string | null) =>
    rows.find((row) => row.kind === kind)?.count ?? 0;

  return {
    considered: rows.reduce((total, row) => total + row.count, 0),
    lemmaReading: of('lemma_reading') + of('lemma_reading_multi'),
    ambiguous: of('lemma_reading_multi'),
    lemmaOnly: of('lemma'),
    unmatched: of(null),
  };
}
