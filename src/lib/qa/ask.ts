import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, questions, sentences, tokens } from '../../db/schema.ts';
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
 * Streams an answer and persists it once complete. The question is stored with
 * the sentence revision it was asked against, so correcting the sentence later
 * marks this answer stale instead of leaving it pointing at text that no longer
 * says what it said.
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

  const provider = getLlmProvider();
  const messages = buildMessages({
    sentenceText: sentence.text,
    tokens: rows,
    selection,
    question: input.question,
  });

  let answer = '';
  for await (const chunk of provider.stream({ messages, signal: input.signal })) {
    answer += chunk;
    yield chunk;
  }

  // A cancelled or empty generation is not worth recording.
  if (answer.trim().length === 0) return;

  db.insert(questions)
    .values({
      id: randomUUID(),
      sentenceId: sentence.id,
      sentenceRevision: sentence.revision,
      charStart: hasSpan ? input.charStart! : null,
      charEnd: hasSpan ? input.charEnd! : null,
      prompt: input.question,
      answer,
      providerId: provider.id,
      modelId: provider.model,
    })
    .run();
}

export interface StoredQuestion {
  id: string;
  sentenceId: string;
  prompt: string;
  answer: string;
  modelId: string;
  createdAt: number;
  /** True when the sentence has been edited since this answer was written. */
  stale: boolean;
}

export function listQuestionsForSection(sectionId: string): StoredQuestion[] {
  return db
    .select({
      id: questions.id,
      sentenceId: questions.sentenceId,
      prompt: questions.prompt,
      answer: questions.answer,
      modelId: questions.modelId,
      createdAt: questions.createdAt,
      askedAt: questions.sentenceRevision,
      revision: sentences.revision,
    })
    .from(questions)
    .innerJoin(sentences, eq(sentences.id, questions.sentenceId))
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(asc(questions.createdAt))
    .all()
    .map(({ askedAt, revision, ...rest }) => ({
      ...rest,
      stale: askedAt < revision,
    }));
}
