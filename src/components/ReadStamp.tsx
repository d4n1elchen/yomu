'use client';

import { useEffect } from 'react';

/** Ten seconds of the article actually being looked at. */
const THRESHOLD_MS = 10_000;

/**
 * Whether this page was reached from a different chapter's page -- a 目次 entry
 * or 上一章/下一章. Nothing else links one reader page to another.
 */
function cameFromAnotherChapter(): boolean {
  try {
    const from = new URL(document.referrer);
    return (
      from.origin === window.location.origin &&
      from.pathname.startsWith('/read/') &&
      from.pathname !== window.location.pathname
    );
  } catch {
    // No referrer at all, which is most arrivals.
    return false;
  }
}

/**
 * Stamps `section.lastReadAt` once the article has been open for ten seconds of
 * *visible* time. The timer pauses while the tab is hidden, so opening six
 * articles in background tabs does not rewrite your reading history.
 *
 * **Except when you came here from another chapter.** Moving through a book is
 * not a glance -- you are already reading it -- and waiting ten seconds meant
 * that opening the next chapter and heading straight back to the Library left
 * the row opening the chapter you had just left. Only while visible, so a
 * chapter opened into a background tab still waits like anything else.
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

    if (!document.hidden && cameFromAnotherChapter()) visibleMs = THRESHOLD_MS;
    check();

    const timer = setInterval(check, 1000);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sectionId]);

  return null;
}
