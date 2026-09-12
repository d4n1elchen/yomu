'use client';

import { useEffect, useState } from 'react';
import type { Article } from '../lib/article.ts';
import {
  deleteChapter,
  isSupported,
  saveChapter,
  storedIds,
} from '../lib/offline/store.ts';

type State = 'checking' | 'absent' | 'saving' | 'saved' | 'failed';

/**
 * Saves this chapter for reading without a network.
 *
 * The download is a copy from memory to disk: the reader already holds the whole
 * article, so nothing is fetched and nothing can half-arrive. Which is also why
 * the control lives here rather than on the Library -- this is the one place the
 * payload is already loaded.
 */
export function DownloadChapter({ article }: { article: Article }) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (!isSupported()) return;
    let live = true;
    void storedIds()
      .then((ids) => {
        if (live) setState(ids.has(article.sectionId) ? 'saved' : 'absent');
      })
      .catch(() => {
        if (live) setState('absent');
      });
    return () => {
      live = false;
    };
  }, [article.sectionId]);

  // No IndexedDB, or the check never finished: draw nothing rather than a
  // control that might not work. Offline reading is an extra, and a dead button
  // is worse than no button.
  if (!isSupported() || state === 'checking') return null;

  const save = async () => {
    setState('saving');
    try {
      await saveChapter(article);
      setState('saved');
    } catch {
      setState('failed');
    }
  };

  const remove = async () => {
    try {
      await deleteChapter(article.sectionId);
      setState('absent');
    } catch {
      setState('failed');
    }
  };

  if (state === 'saved') {
    return (
      <span className="offline-state">
        <span className="offline-ready">已可離線閱讀</span>
        <button type="button" className="link" onClick={() => void remove()}>
          移除
        </button>
      </span>
    );
  }

  return (
    <span className="offline-state">
      <button
        type="button"
        className="link"
        disabled={state === 'saving'}
        onClick={() => void save()}
      >
        {state === 'saving' ? '下載中…' : '下載以離線閱讀'}
      </button>
      {state === 'failed' ? <span className="offline-failed">下載失敗</span> : null}
    </span>
  );
}
