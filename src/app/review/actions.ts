'use server';

import { answerGrammarQuestion } from '../../lib/grammar/quiz.ts';

/**
 * Grades one answer and reschedules the point. The time is the server's, so a
 * device with a wrong clock cannot push its own reviews around.
 */
export async function answerGrammar(
  pointId: string,
  chosenId: string,
): Promise<{ correct: boolean }> {
  return answerGrammarQuestion(pointId, chosenId, Math.floor(Date.now() / 1000));
}
