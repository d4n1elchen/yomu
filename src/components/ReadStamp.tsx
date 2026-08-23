'use client';

import { useEffect } from 'react';

/** Ten seconds of the article actually being looked at. */
const THRESHOLD_MS = 10_000;

/**
 * Stamps `section.lastReadAt` once the article has been open for ten seconds of
 * *visible* time. The timer pauses while the tab is hidden, so opening six
 * articles in background tabs does not rewrite your reading history.
 *
 * Renders nothing.
 */
export function ReadStamp({ sectionId }: { sectionId: string }) {
  useEffect(() => {
    let visibleMs = 0;
    let since: number | null = document.hidden ? null : Date.now();
    let done = false;

    const check = () => {
      if (done) return;
      if (since !== null) {
        const now = Date.now();
        visibleMs += now - since;
        since = now;
      }
      if (visibleMs < THRESHOLD_MS) return;

      done = true;
      // Best effort: failing to record where you were is not worth a message.
      void fetch(`/api/read/${sectionId}`, { method: 'POST' }).catch(() => {});
    };

    const onVisibility = () => {
      if (document.hidden) {
        if (since !== null) {
          visibleMs += Date.now() - since;
          since = null;
        }
      } else {
        since = Date.now();
      }
      check();
    };

    const timer = setInterval(check, 1000);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sectionId]);

  return null;
}
