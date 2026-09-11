'use client';

import { useActionState, useState } from 'react';
import { importEpubFile, type ImportState } from '../app/import/actions.ts';

const initial: ImportState = {};

/**
 * Separate from the paste form rather than a mode switch inside it. The two
 * supply different things -- a book brings its own title, author and chapter
 * boundaries, and a paste brings none of them -- so one form serving both would
 * be three fields that are sometimes ignored.
 */
export function EpubForm() {
  const [state, action, pending] = useActionState(importEpubFile, initial);
  const [name, setName] = useState<string | null>(null);

  return (
    <form action={action}>
      {state.error ? <p className="error">{state.error}</p> : null}
      <label className="field file">
        <span>EPUB 檔案</span>
        <input
          type="file"
          name="file"
          accept=".epub,application/epub+zip"
          onChange={(event) => setName(event.target.files?.[0]?.name ?? null)}
        />
        <span className="hint">
          {name ?? '書名、作者與章節都從檔案裡讀取。'}
        </span>
      </label>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? '分析中…' : '匯入書籍'}
        </button>
      </div>
    </form>
  );
}
