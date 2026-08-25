import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sentences, tokens } from '../../db/schema.ts';
import { beginInteractive } from '../analysis/priority.ts';
import { getLlmProvider, type LlmMessage } from '../llm/index.ts';
import { buildMessages, type PromptSentence } from './prompt.ts';
import type { SelectionSpan } from './selection.ts';

export interface AskInput {
  /** One span per sentence the selection covered, in reading order. */
  spans: SelectionSpan[];
  /** The conversation so far, oldest first, ending with the new question. */
  turns: LlmMessage[];
  signal?: AbortSignal;
}

/**
 * Streams an answer about a selection and keeps nothing.
 *
 * Q&A is deliberately ephemeral: it is a lookup you read and move on from, not
 * a record. Storing it would accumulate prose nobody re-reads, snapshotted from
 * whichever model happened to answer that day. Durable learning is meant to
 * live in the Dictionary as entries and occurrences -- see the note at the
 * bottom of `src/db/schema.ts` about how grammar might eventually get there.
 *
 * A selection may run across sentence boundaries, so every sentence it touched
 * is loaded whole, with its tokenization. A fragment explained without the
 * sentence around it is a fragment explained wrong.
 */
export async function* askAboutSelection(
  input: AskInput,
): AsyncIterable<string> {
  if (input.spans.length === 0) throw new Error('A selection is required.');

  const prompt: PromptSentence[] = input.spans.map((span) => {
    const sentence = db
      .select()
      .from(sentences)
      .where(eq(sentences.id, span.sentenceId))
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
      .where(eq(tokens.sentenceId, span.sentenceId))
      .orderBy(asc(tokens.orderIndex))
      .all();

    // The client computed these offsets against the text it rendered. Clamping
    // rather than trusting them keeps a stale span from slicing out of bounds.
    const charStart = Math.max(0, Math.min(span.charStart, sentence.text.length));
    const charEnd = Math.max(
      charStart,
      Math.min(span.charEnd, sentence.text.length),
    );

    return {
      text: sentence.text,
      tokens: rows,
      selected: sentence.text.slice(charStart, charEnd),
    };
  });

  const messages = buildMessages({ sentences: prompt, turns: input.turns });

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
