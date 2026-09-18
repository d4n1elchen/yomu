'use server';

import {
  keepGrammarPoint,
  releaseGrammarPoint,
  type GrammarExample,
} from '../../lib/grammar/library.ts';
import { addName } from '../../lib/names.ts';
import { setLearning } from '../../lib/vocab.ts';

/**
 * Keeps a grammar point from a card, with the sentence it was found in as an
 * example -- or, for a point already kept, adds just the example. One call for
 * both, because they are the same tap.
 *
 * Returns an error to show rather than throwing, like `confirmName`: the card
 * stays open, and a refusal is something to say on it.
 */
export async function keepGrammar(
  example: GrammarExample,
): Promise<{ error: string | null }> {
  try {
    keepGrammarPoint(example);
    return { error: null };
  } catch (error) {
    return { error: error instanceof Error ? error.message : '無法加入文法庫。' };
  }
}

/** Takes a point out of the 文法庫, and its example sentences with it. */
export async function releaseGrammar(pointId: string): Promise<void> {
  if (!pointId) return;
  releaseGrammarPoint(pointId);
}

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
