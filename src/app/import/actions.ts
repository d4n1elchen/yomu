'use server';

import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { ensureDraining } from '../../lib/analysis/drain.ts';
import { parseEpub } from '../../lib/epub/epub.ts';
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

/**
 * An EPUB arrives as one work with its chapters already separated, which is the
 * whole reason the format is worth reading: pasting gives one wall of text with
 * no boundaries in it, while a book carries its own table of contents.
 *
 * Everything past parsing is the pasted-text path unchanged. `ingestWork` has
 * always taken a list of sections and said in its own comment that splitting a
 * novel into chapters happens at the call site -- this is that call site, and no
 * part of the schema, the analysis passes or the reader needed a change to
 * accept a book.
 */
export async function importEpubFile(
  _prev: ImportState,
  formData: FormData,
): Promise<ImportState> {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: '請先選擇一個 EPUB 檔案。' };
  }

  let book;
  try {
    book = parseEpub(Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    // Every message `parseEpub` throws is already written for a reader. Anything
    // else is a surprise, and saying so beats printing a stack trace's first line.
    return {
      error: error instanceof Error ? error.message : '無法讀取這個 EPUB 檔案。',
    };
  }

  await ingestWork({
    title: book.title,
    author: book.author,
    sourceType: book.sourceType,
    sections: book.sections.map((section) => ({
      title: section.title,
      body: section.body,
      parts: section.parts?.map((part) => ({ title: part.title, body: part.body })),
    })),
  });

  after(ensureDraining);
  redirect('/library');
}
