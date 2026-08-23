'use client';

import { useActionState } from 'react';
import { importPastedText, type ImportState } from '../app/import/actions.ts';

const initial: ImportState = {};

export function ImportForm() {
  const [state, action, pending] = useActionState(importPastedText, initial);

  return (
    <form action={action}>
      {state.error ? <p className="error">{state.error}</p> : null}
      <label className="field">
        <span>標題</span>
        <input type="text" name="title" placeholder="選填" />
      </label>
      <label className="field">
        <span>日文原文</span>
        <textarea
          name="body"
          lang="ja"
          placeholder="ここに日本語を貼り付けてください。"
        />
      </label>
      <div className="actions">
        <button type="submit" disabled={pending}>
          {pending ? '分析中…' : '新增文章'}
        </button>
        <a className="cancel" href="/library">
          取消
        </a>
      </div>
    </form>
  );
}
