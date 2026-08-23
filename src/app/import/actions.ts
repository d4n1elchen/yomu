'use server';

import { redirect } from 'next/navigation';
import { ingestWork } from '../../lib/import/ingest.ts';

export interface ImportState {
  error?: string;
}

export async function importPastedText(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();

  if (body.length === 0) return { error: '請先貼上一段日文。' };

  const { sectionIds } = await ingestWork({
    title: title || '未命名',
    sourceType: 'paste',
    // One section today. Splitting a novel into chapters happens here.
    sections: [{ body }],
  });

  // redirect throws, so it must sit outside any try/catch.
  redirect(`/read/${sectionIds[0]}`);
}
