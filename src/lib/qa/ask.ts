import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sentences, tokens } from '../../db/schema.ts';
import { beginInteractive } from '../analysis/priority.ts';
import { getLlmProvider, type LlmMessage } from '../llm/index.ts';
import { loadGrammar } from '../grammar/load.ts';
import { buildMessages, type PromptGrammar, type PromptInput } from './prompt.ts';

/** A point the grammar card showed, as the client names it. */
export interface AskGrammarRef {
  pointId: string;
  surface: string;
}

export interface AskInput {
  /** The sentence being asked about. */
  sentenceId: string;
  /** The conversation so far, oldest first, ending with the new question. */
  turns: LlmMessage[];
  /** What the grammar card identified, minus anything the reader dismissed. */
  grammar?: AskGrammarRef[];
  signal?: AbortSignal;
}

/**
 * Turns the card's points into prompt lines, trusting none of it.
 *
 * The client sends ids and surfaces, never names or glosses: the text the model
 * reads comes from the inventory, so a request cannot put words in the
 * teacher's mouth. An id the inventory lacks, a point with no reviewed Chinese
 * yet, or a surface that is not in the sentence is dropped -- the same contract
 * as `parseIdentification`.
 */
export function resolveAskGrammar(
  sentence: string,
  refs: AskGrammarRef[],
): PromptGrammar[] {
  if (refs.length === 0) return [];
  const library = loadGrammar();
  const seen = new Set<string>();
  const lines: PromptGrammar[] = [];
  for (const ref of refs) {
    if (seen.has(ref.pointId) || !sentence.includes(ref.surface)) continue;
    const point = library.point(ref.pointId);
    if (!point?.nameZh || !point.glossZh) continue;
    seen.add(ref.pointId);
    lines.push({ surface: ref.surface, name: point.nameZh, gloss: point.glossZh });
  }
  return lines;
}

/**
 * The target sentence with its tokenization, and the text of the sentences
 * either side of it in the same section.
 *
 * Neighbours are found by `orderIndex` rather than by `orderIndex ± 1000`: the
 * index is sparse so a transcript correction can split or merge sentences, and
 * after one the gaps are no longer even. A neighbour never crosses into another
 * section -- the end of a chapter is a real break in the text.
 */
export function loadAskContext(
  sentenceId: string,
): Omit<PromptInput, 'turns'> {
  const sentence = db
    .select()
    .from(sentences)
    .where(eq(sentences.id, sentenceId))
    .get();

  if (!sentence) throw new Error('Sentence not found.');

  const rows = db
    .select({
      surface: tokens.surface,
      reading: tokens.reading,
      lemma: lexemes.lemma,
      pos: lexemes.pos,
    })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .where(eq(tokens.sentenceId, sentenceId))
    .orderBy(asc(tokens.orderIndex))
    .all();

  const previous = db
    .select({ text: sentences.text })
    .from(sentences)
    .where(
      and(
        eq(sentences.sectionId, sentence.sectionId),
        lt(sentences.orderIndex, sentence.orderIndex),
      ),
    )
    .orderBy(desc(sentences.orderIndex))
    .limit(1)
    .get();

  const next = db
    .select({ text: sentences.text })
    .from(sentences)
    .where(
      and(
        eq(sentences.sectionId, sentence.sectionId),
        gt(sentences.orderIndex, sentence.orderIndex),
      ),
    )
    .orderBy(asc(sentences.orderIndex))
    .limit(1)
    .get();

  return {
    target: { text: sentence.text, tokens: rows },
    previous: previous?.text ?? null,
    next: next?.text ?? null,
  };
}

/**
 * Streams an answer about a sentence and keeps nothing.
 *
 * Q&A is deliberately ephemeral: it is a lookup you read and move on from, not
 * a record. Storing it would accumulate prose nobody re-reads, snapshotted from
 * whichever model happened to answer that day. Durable learning lives in the
 * Dictionary as entries and occurrences, and a grammar card is how Q&A adds one.
 *
 * The sentences either side travel with it. A sentence explained without the
 * one before it loses its omitted subject and what its これ points at.
 */
export async function* askAboutSentence(
  input: AskInput,
): AsyncIterable<string> {
  const context = loadAskContext(input.sentenceId);
  const messages = buildMessages({
    ...context,
    grammar: resolveAskGrammar(context.target.text, input.grammar ?? []),
    turns: input.turns,
  });

  // The background drain stands aside while this runs. Released in `finally`,
  // which a generator runs on an aborted stream too -- a reader who closes the
  // card must not leave the drain waiting on a question nobody is asking.
  const release = beginInteractive();
  try {
    yield* getLlmProvider().stream({ messages, signal: input.signal });
  } finally {
    release();
  }
}
