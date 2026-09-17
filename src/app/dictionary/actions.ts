'use server';

import { revalidatePath } from 'next/cache';
import { removeName } from '../../lib/names.ts';

/**
 * Takes a confirmed name back, from its row in the Dictionary's 人名 list. The
 * works it was confirmed in are re-analysed, so its pieces are words again.
 */
export async function unconfirmName(formData: FormData): Promise<void> {
  const lexemeId = formData.get('lexemeId');
  if (typeof lexemeId !== 'string' || lexemeId === '') return;
  await removeName(lexemeId);
  revalidatePath('/dictionary');
}
