import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  dictEntries,
  dictSenses,
  lexemes,
  sections,
  sentences,
  tokens,
} from '../../db/schema.ts';
import { runAbortable, yieldToInteractive } from '../analysis/priority.ts';
import { sameMeaning } from '../dictionary.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';
import { matchCandidates } from './match.ts';
import type { AnalyzerPos } from './pos.ts';
import { posAgrees } from './pos.ts';
import {
  buildResolverMessages,
  NONE,
  parseResolution,
  RESOLVER_FORMAT,
  type ResolverCandidate,
} from './resolve-prompt.ts';

/** A lexeme whose match left several entries standing, awaiting resolution. */
export interface AmbiguousLexeme {
  id: string;
  lemma: string;
  reading: string;
  pos: string;
  posDetail: string | null;
  conjugationType: string | null;
}

/**
 * The `lemma_reading_multi` lexemes in a section that have not been resolved --
 * `dictResolver is null`. Only these: a clean `lemma_reading` is never touched,
 * and a link the model already resolved is never re-resolved, so the Dictionary
 * grouping does not shift under a reader between runs.
 */
export function ambiguousLexemes(sectionId: string): AmbiguousLexeme[] {
  return db
    .selectDistinct({
      id: lexemes.id,
      lemma: lexemes.lemma,
      reading: lexemes.reading,
      pos: lexemes.pos,
      posDetail: lexemes.posDetail,
      conjugationType: lexemes.conjugationType,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(
      and(
        eq(sentences.sectionId, sectionId),
        eq(lexemes.dictMatch, 'lemma_reading_multi'),
        isNull(lexemes.dictResolver),
      ),
    )
    .all();
}

/** How many senses of one candidate the model is shown. */
const MAX_GLOSSES = 3;

/** How many sentences stand for the word. */
const MAX_OCCURRENCES = 3;

/**
 * What tells one survivor from another: headword, reading, whether JMdict calls
 * it common, and the senses that fit this word's grammar -- the entry's leading
 * sense when none of them does.
 */
function candidateOf(entryId: string, analyzer: AnalyzerPos): ResolverCandidate | null {
  const entry = db
    .select({
      headword: dictEntries.headword,
      reading: dictEntries.reading,
      band: dictEntries.freqBand,
      common: dictEntries.common,
    })
    .from(dictEntries)
    .where(eq(dictEntries.id, entryId))
    .get();
  if (!entry) return null;

  const senses = db
    .select({ en: dictSenses.glossEn, pos: dictSenses.pos })
    .from(dictSenses)
    .where(eq(dictSenses.entryId, entryId))
    .orderBy(asc(dictSenses.orderIndex))
    .all();
  if (senses.length === 0) return null;

  const fitting = senses.filter((sense) => posAgrees(analyzer, sense.pos.split(',')));
  const shown = (fitting.length > 0 ? fitting : senses).slice(0, MAX_GLOSSES);

  return {
    entryId,
    headword: entry.headword,
    reading: entry.reading,
    glosses: shown.map((sense) => sense.en),
    common: entry.common || entry.band !== null,
  };
}

/**
 * Sentences this lexeme occurs in, with the surface as written -- the context
 * the model reads the choice out of. The section being resolved goes first, then
 * the rest of the library, distinct sentences only. The link is per lexeme, so
 * the pick should fit how the word is used across the reading, not whichever
 * single sentence happened to come first: a lone かもしれない read without its
 * neighbours was enough to choose 痴れる "to become foolish".
 */
function occurrencesOf(
  lexemeId: string,
  sectionId: string,
): Array<{ sentence: string; surface: string }> {
  const rows = db
    .select({ sentence: sentences.text, surface: tokens.surface })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(and(eq(tokens.lexemeId, lexemeId), eq(sentences.needsReview, false)))
    .orderBy(
      sql`${sentences.sectionId} = ${sectionId} desc`,
      asc(sentences.sectionId),
      asc(sentences.orderIndex),
      asc(tokens.orderIndex),
    )
    .limit(MAX_OCCURRENCES * 4)
    .all();

  const seen = new Set<string>();
  const picked: Array<{ sentence: string; surface: string }> = [];
  for (const row of rows) {
    if (seen.has(row.sentence)) continue;
    seen.add(row.sentence);
    picked.push(row);
    if (picked.length === MAX_OCCURRENCES) break;
  }
  return picked;
}

/**
 * Asks the model which entry the word is, retrying once on a reply that names no
 * offered id. Returns the chosen entry id, or null to keep the deterministic
 * pick. A network failure propagates so the caller can stop the pass rather than
 * ask an unreachable host once per lexeme.
 */
export async function resolveOne(
  provider: LlmProvider,
  context: Parameters<typeof buildResolverMessages>[0],
): Promise<{ entryId: string | null } | 'abandoned'> {
  const messages = buildResolverMessages(context);
  const ids = context.candidates.map((candidate) => candidate.entryId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const run = await runAbortable((signal) =>
      collect(
        provider.stream({
          messages,
          temperature: 0,
          format: RESOLVER_FORMAT,
          signal,
        }),
      ),
    );
    if (run === null) return 'abandoned';

    const chosen = parseResolution(run.value, ids);
    if (chosen) return { entryId: chosen };
  }
  return { entryId: null };
}

/**
 * Settles the homograph ambiguity in one section, where JMdict itself cannot:
 * several entries survived lemma, reading and grammar, and the commonest was
 * taken deterministically even when it is the wrong word -- なる takes 生る over
 * 成る because frequency points that way.
 *
 * Fires only where the survivors actually mean different things: two 三 both
 * glossing "three" is a choice with no visible consequence, so asking is pure
 * cost. When the model picks a valid candidate the link moves to it and the pick
 * is stamped with the model, so it reads as resolved rather than computed and is
 * never asked again.
 *
 * Stamps `section.resolvedAt` on completion, which is what makes the section
 * readable -- until then the Library greys it, because the links this pass moves
 * are the ones the Dictionary groups on.
 *
 * The three outcomes are deliberately distinct. `unreachable` is the only one
 * that should stop the drain and start a backoff; `abandoned` means a reader
 * asked a question and this pass stepped aside, which must not be mistaken for a
 * dead host or a single question would idle the drain for minutes.
 *
 * Progress counters are rewritten at the start of every run, so a resumed pass
 * reports the work actually left rather than counting what a previous run
 * already finished.
 */
export type ResolveOutcome = 'done' | 'abandoned' | 'unreachable';

export async function resolveSectionAmbiguity(
  sectionId: string,
  provider?: LlmProvider,
): Promise<ResolveOutcome> {
  const pending = ambiguousLexemes(sectionId);

  db.update(sections)
    .set({ resolveTotal: pending.length, resolveDone: 0 })
    .where(eq(sections.id, sectionId))
    .run();

  let llm: LlmProvider | null = null;
  let done = 0;

  const advance = () => {
    done += 1;
    db.update(sections)
      .set({ resolveDone: done })
      .where(eq(sections.id, sectionId))
      .run();
  };

  for (const lexeme of pending) {
    const context = resolverContext(lexeme, sectionId);
    if (!context) {
      advance();
      continue;
    }

    await yieldToInteractive();
    llm ??= provider ?? getLlmProvider();
    let outcome: Awaited<ReturnType<typeof resolveOne>>;
    try {
      outcome = await resolveOne(llm, context);
    } catch {
      // Host unreachable: leave this section pending for a later drain.
      return 'unreachable';
    }

    // Abandoned for a reader's question. The section stays unresolved, which is
    // its own queue, so a later drain resumes exactly here -- and crucially this
    // is not reported as a host failure.
    if (outcome === 'abandoned') return 'abandoned';

    writeResolution(lexeme.id, outcome.entryId, llm.model);
    advance();
  }

  db.update(sections)
    .set({ resolvedAt: Math.floor(Date.now() / 1000) })
    .where(eq(sections.id, sectionId))
    .run();

  return 'done';
}

/**
 * What the model is asked about one lexeme, or null when there is nothing to
 * ask: fewer than two survivors, survivors that all mean the same thing, or no
 * reviewed sentence to read the choice out of.
 */
export function resolverContext(
  lexeme: AmbiguousLexeme,
  sectionId: string,
): Parameters<typeof buildResolverMessages>[0] | null {
  const found = matchCandidates(lexeme.lemma, lexeme.reading, lexeme);
  if (found === null || found.survivors.length < 2) return null;
  const candidates = found.survivors
    .map((entryId) => candidateOf(entryId, lexeme))
    .filter((c): c is ResolverCandidate => c !== null);

  // Only ask when the survivors genuinely differ. If every candidate reduces
  // to the same leading meaning, the deterministic pick is as good as any --
  // and the lexeme is finished without a request ever being made.
  const meanings = new Set(candidates.map((c) => sameMeaning(c.glosses[0] ?? '')));
  if (candidates.length < 2 || meanings.size < 2) return null;

  const occurrences = occurrencesOf(lexeme.id, sectionId);
  return occurrences.length === 0 ? null : { occurrences, candidates };
}

/**
 * Records the model's answer. A pick moves the link; a rejection removes it, and
 * both are stamped with the model so the lexeme is never asked again and a
 * non-relink `linkLexemes` leaves the rejection standing. No answer at all keeps
 * the deterministic pick, unstamped.
 */
export function writeResolution(
  lexemeId: string,
  entryId: string | null,
  model: string,
): void {
  if (entryId === null) return;
  db.update(lexemes)
    .set(
      entryId === NONE
        ? { dictEntryId: null, dictMatch: null, dictResolver: model }
        : { dictEntryId: entryId, dictResolver: model },
    )
    .where(eq(lexemes.id, lexemeId))
    .run();
}
