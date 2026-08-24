'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { ensureDraining } from '../../lib/analysis/drain.ts';
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

  await ingestWork({
    title: title || '未命名',
    sourceType: 'paste',
    // One section today. Splitting a novel into chapters happens here.
    sections: [{ body }],
  });

  // The model passes run after the response rather than inside it. A chapter is
  // hundreds of requests to a host that serializes them, and waiting for that
  // with the form still on screen was indistinguishable from a hang. `after`
  // still runs when the action ends in a redirect, which is exactly this shape.
  after(ensureDraining);

  // To the Library, not the reader: the article is not readable until homograph
  // resolution has settled the links the Dictionary groups on, and the Library
  // is where that progress is shown.
  //
  // redirect throws, so it must sit outside any try/catch -- and after `after`,
  // which never gets called otherwise.
  redirect('/library');
}
