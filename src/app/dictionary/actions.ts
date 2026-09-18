'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { releaseGrammarPoint } from '../../lib/grammar/library.ts';
import { removeName } from '../../lib/names.ts';

/**
 * Takes a point out of the 文法庫 from its page, and returns to the list --
 * the page it was on is now about something you no longer keep.
 */
export async function releaseGrammarFromDictionary(formData: FormData): Promise<void> {
  const pointId = formData.get('pointId');
  if (typeof pointId !== 'string' || pointId === '') return;
  releaseGrammarPoint(pointId);
  revalidatePath('/dictionary');
  redirect('/dictionary?grammar=1');
}

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
