'use server';

import { addName } from '../../lib/names.ts';
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

/**
 * Confirms a name from the word card, and re-analyses every chapter of the work
 * it occurs in. Returns an error to print on the card rather than throwing: the
 * reader stays open either way, and a refusal -- the text is not in the chapter,
 * a stray space -- is something to say, not a crash.
 */
export async function confirmName(
  sectionId: string,
  surface: string,
): Promise<{ error: string | null }> {
  try {
    await addName(sectionId, surface);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '無法標為人名。' };
  }
}
