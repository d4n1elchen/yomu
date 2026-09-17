import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sentences, tokens } from '../../db/schema.ts';
import { beginInteractive } from '../analysis/priority.ts';
import { getLlmProvider, type LlmMessage } from '../llm/index.ts';
import { buildMessages, type PromptInput } from './prompt.ts';

export interface AskInput {
  /** The sentence being asked about. */
  sentenceId: string;
  /** The conversation so far, oldest first, ending with the new question. */
  turns: LlmMessage[];
  signal?: AbortSignal;
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
 * whichever model happened to answer that day. Durable learning is meant to
 * live in the Dictionary as entries and occurrences -- see the note at the
 * bottom of `src/db/schema.ts` about how grammar might eventually get there.
 *
 * The sentences either side travel with it. A sentence explained without the
 * one before it loses its omitted subject and what its これ points at.
 */
export async function* askAboutSentence(
  input: AskInput,
): AsyncIterable<string> {
  const messages = buildMessages({
    ...loadAskContext(input.sentenceId),
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
