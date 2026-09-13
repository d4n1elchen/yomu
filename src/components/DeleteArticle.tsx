'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { deleteArticle } from '../app/library/actions.ts';
import { deleteWorkChapters, isSupported } from '../lib/offline/store.ts';

/** How long a primed delete stays primed before going back to sleep. */
const ARM_MS = 5000;

type State = 'idle' | 'confirming' | 'deleting';

/**
 * Deleting a work, confirmed in place rather than in a dialog.
 *
 * Two taps, because this cannot be undone -- there is no trash and the text is
 * gone with the row. A dialog would be the conventional answer and is the one
 * thing this interface does not have anywhere; adding one here would make
 * deletion the most ceremonious action in the app.
 *
 * The primed state disarms itself after a few seconds, so a stray tap on a
 * phone does not leave a live delete button sitting under your thumb.
 */
export function DeleteArticle({
  workId,
  title,
  sectionCount,
}: {
  workId: string;
  title: string;
  sectionCount: number;
}) {
  const [state, setState] = useState<State>('idle');
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state !== 'confirming') return;
    timer.current = setTimeout(() => setState('idle'), ARM_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [state]);

  if (state === 'idle') {
    return (
      <button
        type="button"
        className="link delete"
        aria-label={`刪除${title}`}
        onClick={() => setState('confirming')}
      >
        刪除
      </button>
    );
  }

  return (
    <span className="confirm-delete">
      <span className="confirm-label">
        {/* A book is many chapters behind one row, and deleting the row takes
            all of them. Saying so is the difference between a confirmation and
            a formality. */}
        {sectionCount > 1 ? `刪除全部 ${sectionCount} 章？` : '確定刪除？'}
      </span>
      <button
        type="button"
        className="link danger"
        disabled={state === 'deleting'}
        onClick={() => {
          setState('deleting');
          void deleteArticle(workId)
            .then(async () => {
              // The offline copies go too, on this device. The server cannot
              // reach IndexedDB, so this click is the only moment anything
              // knows both that the work is gone and which downloads belonged
              // to it. Failure here is swallowed: the article is already
              // deleted, and a leftover download still reads.
              if (isSupported()) await deleteWorkChapters(workId).catch(() => 0);
              router.refresh();
            })
            .catch(() => setState('idle'));
        }}
      >
        {state === 'deleting' ? '刪除中…' : '刪除'}
      </button>
      <button
        type="button"
        className="link"
        disabled={state === 'deleting'}
        onClick={() => setState('idle')}
      >
        取消
      </button>
    </span>
  );
}
