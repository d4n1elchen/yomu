import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  dictEntries,
  dictSenses,
  lexemes,
  sections,
  sentences,
  tokens,
} from '../../db/schema.ts';
import { sameMeaning } from '../dictionary.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';
import { matchCandidates } from './match.ts';
import {
  buildResolverMessages,
  parseResolution,
  RESOLVER_FORMAT,
  type ResolverCandidate,
} from './resolve-prompt.ts';

/** A lexeme whose match left several entries standing, awaiting resolution. */
interface AmbiguousLexeme {
  id: string;
  lemma: string;
  reading: string;
  pos: string;
  posDetail: string | null;
  conjugationType: string | null;
}

/**
 * The `lemma_reading_multi` lexemes this work introduced that have not been
 * resolved yet -- `dict_resolver is null`. Only these: a clean `lemma_reading`
 * is never touched, and a link the model already resolved is never re-resolved,
 * so the Dictionary's grouping does not shift under a reader between runs.
 */
function ambiguousLexemes(workId: string): AmbiguousLexeme[] {
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
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(
      and(
        eq(sections.workId, workId),
        eq(lexemes.dictMatch, 'lemma_reading_multi'),
        isNull(lexemes.dictResolver),
      ),
    )
    .all();
}

/** The entry's leading gloss, headword and reading -- what tells one survivor
 *  from another. */
function candidateOf(entryId: string): ResolverCandidate | null {
  const entry = db
    .select({ headword: dictEntries.headword, reading: dictEntries.reading })
    .from(dictEntries)
    .where(eq(dictEntries.id, entryId))
    .get();
  if (!entry) return null;

  const gloss = db
    .select({ en: dictSenses.glossEn })
    .from(dictSenses)
    .where(eq(dictSenses.entryId, entryId))
    .orderBy(asc(dictSenses.orderIndex))
    .limit(1)
    .get();
  if (!gloss) return null;

  return {
    entryId,
    headword: entry.headword,
    reading: entry.reading,
    glossEn: gloss.en,
  };
}

/** A sentence this lexeme occurs in, with the surface as written -- the context
 *  the model reads the choice out of. One occurrence stands for the lexeme: the
 *  link is per-lexeme, so a single representative sentence is all there is to
 *  pick from. */
function occurrenceOf(
  lexemeId: string,
  workId: string,
): { sentence: string; surface: string } | null {
  return (
    db
      .select({ sentence: sentences.text, surface: tokens.surface })
      .from(tokens)
      .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
      .innerJoin(sections, eq(sections.id, sentences.sectionId))
      .where(and(eq(tokens.lexemeId, lexemeId), eq(sections.workId, workId)))
      .orderBy(asc(sentences.orderIndex), asc(tokens.orderIndex))
      .limit(1)
      .get() ?? null
  );
}

/**
 * Asks the model which entry the word is, retrying once on a reply that names no
 * offered id. Returns the chosen entry id, or null to keep the deterministic
 * pick. A network failure propagates so the caller can stop the pass rather than
 * ask an unreachable host once per lexeme.
 */
async function resolveOne(
  provider: LlmProvider,
  context: Parameters<typeof buildResolverMessages>[0],
): Promise<string | null> {
  const messages = buildResolverMessages(context);
  const ids = context.candidates.map((candidate) => candidate.entryId);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const raw = await collect(
      provider.stream({ messages, temperature: 0, format: RESOLVER_FORMAT }),
    );
    const chosen = parseResolution(raw, ids);
    if (chosen) return chosen;
  }
  return null;
}

/**
 * Settles the homograph ambiguity this work introduced, where JMdict itself
 * cannot: several entries survived lemma, reading and grammar, and the
 * commonest was taken deterministically even when it is the wrong word -- なる
 * takes 生る over 成る because frequency points that way.
 *
 * Fires only where the survivors actually mean different things: two 三 both
 * glossing "three" is a choice with no visible consequence, so asking is pure
 * cost. When the model picks a valid candidate the link moves to it and the pick
 * is stamped with the model, so it reads as resolved rather than computed and is
 * never asked again. An unreachable host leaves every link at its deterministic
 * pick, to be revisited only if the word turns up in a later import.
 */
export async function resolveAmbiguousForWork(
  workId: string,
  provider?: LlmProvider,
): Promise<void> {
  const ambiguous = ambiguousLexemes(workId);
  if (ambiguous.length === 0) return;

  let llm: LlmProvider | null = null;
  for (const lexeme of ambiguous) {
    const found = matchCandidates(lexeme.lemma, lexeme.reading, lexeme);
    if (!found || found.survivors.length < 2) continue;

    const candidates = found.survivors
      .map(candidateOf)
      .filter((candidate): candidate is ResolverCandidate => candidate !== null);
    if (candidates.length < 2) continue;

    // Only ask when the survivors genuinely differ. If every candidate reduces
    // to the same leading meaning, the deterministic pick is as good as any.
    const meanings = new Set(candidates.map((candidate) => sameMeaning(candidate.glossEn)));
    if (meanings.size < 2) continue;

    const occurrence = occurrenceOf(lexeme.id, workId);
    if (!occurrence) continue;

    llm ??= provider ?? getLlmProvider();
    let chosen: string | null;
    try {
      chosen = await resolveOne(llm, {
        sentence: occurrence.sentence,
        surface: occurrence.surface,
        candidates,
      });
    } catch {
      // Host unreachable: leave every remaining link at its deterministic pick.
      return;
    }
    if (!chosen) continue;

    db.update(lexemes)
      .set({ dictEntryId: chosen, dictResolver: llm.model })
      .where(eq(lexemes.id, lexeme.id))
      .run();
  }
}
