'use server';

import { revalidatePath } from 'next/cache';
import { deleteWork } from '../../lib/article.ts';

/**
 * Deletes a work and everything derived from its text.
 *
 * The Dictionary is revalidated alongside the Library because its counts are
 * occurrences, and this removed some -- a word met only here stops being listed,
 * though it keeps its row and its 生詞 mark. Leaving the Dictionary showing a
 * tally for text that no longer exists would be the one visibly wrong thing.
 */
export async function deleteArticle(workId: string): Promise<void> {
  if (!workId) return;
  deleteWork(workId);
  revalidatePath('/library');
  revalidatePath('/dictionary');
}
