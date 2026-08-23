import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sentences, tokens } from '../../db/schema.ts';
import { getLlmProvider } from '../llm/index.ts';
import { buildMessages } from './prompt.ts';

export interface AskInput {
  sentenceId: string;
  question: string;
  charStart?: number | null;
  charEnd?: number | null;
  signal?: AbortSignal;
}

/**
 * Streams an answer about a sentence and keeps nothing.
 *
 * Q&A is deliberately ephemeral: it is a lookup you read and move on from, not
 * a record. Storing it would accumulate prose nobody re-reads, snapshotted from
 * whichever model happened to answer that day. Durable learning is meant to
 * live in the Dictionary as entries and occurrences -- see the note at the
 * bottom of `src/db/schema.ts` about how grammar might eventually get there.
 */
export async function* askAboutSentence(
  input: AskInput,
): AsyncIterable<string> {
  const sentence = db
    .select()
    .from(sentences)
    .where(eq(sentences.id, input.sentenceId))
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
    .where(eq(tokens.sentenceId, input.sentenceId))
    .orderBy(asc(tokens.orderIndex))
    .all();

  const hasSpan =
    typeof input.charStart === 'number' && typeof input.charEnd === 'number';
  const selection = hasSpan
    ? sentence.text.slice(input.charStart!, input.charEnd!)
    : null;

  const messages = buildMessages({
    sentenceText: sentence.text,
    tokens: rows,
    selection,
    question: input.question,
  });

  yield* getLlmProvider().stream({ messages, signal: input.signal });
}
