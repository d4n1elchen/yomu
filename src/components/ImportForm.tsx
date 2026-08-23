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
        <span>TITLE</span>
        <input type="text" name="title" placeholder="Untitled" />
      </label>
      <label className="field">
        <span>JAPANESE TEXT</span>
        <textarea name="body" placeholder="ここに日本語を貼り付けてください。" />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? 'Analyzing…' : 'Create lesson'}
      </button>
    </form>
  );
}
