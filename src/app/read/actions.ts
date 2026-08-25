'use server';

import { setLearning } from '../../lib/vocab.ts';

/**
 * Adds or removes a word from the 生詞 list.
 *
 * No `revalidatePath`: the reader updates optimistically and nothing else on the
 * page depends on this. Underlining is statistical and unaffected, so there is
 * no server-rendered state to bring back into line -- which is the whole point
 * of keeping the two separate.
 */
export async function toggleLearning(
  lexemeId: string,
  learning: boolean,
): Promise<void> {
  if (!lexemeId) return;
  setLearning(lexemeId, learning);
}
