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
 * One lookup shared by every control mounted together. A book's contents list
 * draws one per chapter, and sixty chapters should not open IndexedDB sixty
 * times to answer the same question. Cleared once it settles, so a later mount
 * sees downloads made since.
 */
let pending: Promise<Set<string>> | null = null;

function downloaded(): Promise<Set<string>> {
  pending ??= storedIds().finally(() => {
    pending = null;
  });
  return pending;
}

/**
 * Saves a chapter for reading without a network.
 *
 * For a single article the control sits above the text and saves the `Article`
 * the reader already holds -- a copy from memory to disk. For a book it sits on
 * each row of the contents list, where only the section id is at hand, so the
 * chapter is fetched first and then written in one piece: nothing is stored
 * until the whole payload has arrived.
 */
export function DownloadChapter({
  sectionId,
  article,
  compact = false,
}: {
  sectionId: string;
  article?: Article;
  /** The short labels a contents row has room for. */
  compact?: boolean;
}) {
  const [state, setState] = useState<State>('checking');

  useEffect(() => {
    if (!isSupported()) return;
    let live = true;
    void downloaded()
      .then((ids) => {
        if (live) setState(ids.has(sectionId) ? 'saved' : 'absent');
      })
      .catch(() => {
        if (live) setState('absent');
      });
    return () => {
      live = false;
    };
  }, [sectionId]);

  // No IndexedDB, or the check never finished: draw nothing rather than a
  // control that might not work. Offline reading is an extra, and a dead button
  // is worse than no button.
  if (!isSupported() || state === 'checking') return null;

  const save = async () => {
    setState('saving');
    try {
      let payload = article;
      if (!payload) {
        const response = await fetch(`/api/read/${sectionId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        payload = (await response.json()) as Article;
      }
      await saveChapter(payload);
      setState('saved');
    } catch {
      setState('failed');
    }
  };

  const remove = async () => {
    try {
      await deleteChapter(sectionId);
      setState('absent');
    } catch {
      setState('failed');
    }
  };

  const className = compact ? 'offline-state compact' : 'offline-state';

  if (state === 'saved') {
    return (
      <span className={className}>
        <span className="offline-ready">{compact ? '已下載' : '已可離線閱讀'}</span>
        <button type="button" className="link" onClick={() => void remove()}>
          移除
        </button>
      </span>
    );
  }

  return (
    <span className={className}>
      {state === 'failed' ? <span className="offline-failed">下載失敗</span> : null}
      <button
        type="button"
        className="link"
        disabled={state === 'saving'}
        onClick={() => void save()}
      >
        {state === 'saving'
          ? '下載中…'
          : compact
            ? state === 'failed'
              ? '重試'
              : '下載'
            : '下載以離線閱讀'}
      </button>
    </span>
  );
}
