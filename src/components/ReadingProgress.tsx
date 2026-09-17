'use client';

import { useEffect, type RefObject } from 'react';
import { isSupported, rememberProgress } from '../lib/offline/store.ts';
import { currentSentence } from '../lib/reading/progress.ts';

/** How long scrolling must stop before the position counts as settled. */
const SETTLE_MS = 1_000;

/**
 * Scrolls in the first moment after opening are not yours: the resume below
 * (for as long as it is still moving -- see `RESUME_QUIET_MS`), the browser jumping to a `#sentence-` anchor or restoring a reload's offset,
 * scroll anchoring as the fonts land. None of them is reading.
 */
const ARM_AFTER_MS = 800;

/**
 * During a smooth resume, how long scroll events must stop before the glide
 * counts as over. Long enough to span the gap between animation frames on a
 * busy phone, short enough that scrolling straight after arriving still counts.
 */
const RESUME_QUIET_MS = 200;

/** Room above the resumed sentence, so it does not sit flush under the header. */
const RESUME_GAP_PX = 16;

/**
 * The line a sentence has to reach to count as started: just under the sticky
 * header, where resuming puts it. The extra pixel absorbs scroll offsets being
 * rounded to whole pixels, so a resumed sentence reports itself.
 */
function readingLine(): number {
  const header = document.querySelector('.site-header');
  return (header?.getBoundingClientRect().bottom ?? 0) + RESUME_GAP_PX;
}

/** The top of a sentence's first line -- not its bounding box, which starts at the column edge once it wraps. */
function firstLineTop(element: HTMLElement): number {
  return (element.getClientRects()[0] ?? element.getBoundingClientRect()).top;
}

/**
 * Remembers where in a section you are, and takes you back there on open.
 *
 * "Where" is a sentence -- see `currentSentence` for which one, and for why
 * that choice keeps the bookmark from creeping. It is saved once scrolling has
 * settled, and again as the page is hidden or left, which is the last moment a
 * phone guarantees to let anything run; that save uses `keepalive` so the
 * request outlives the page.
 *
 * Nothing is saved until you scroll. Opening a chapter to glance at it must not
 * move the bookmark, and neither must arriving from a Dictionary occurrence
 * link -- a URL with a `#sentence-` anchor, which wins over the saved position
 * because you asked for that sentence specifically.
 *
 * Every save also goes to the downloaded copy when there is one, so reading
 * offline resumes too. Both writes are best effort and swallowed, as
 * `ReadStamp`'s is: losing a bookmark is not worth an error.
 *
 * Renders nothing.
 */
export function ReadingProgress({
  sectionId,
  sentenceId,
  root,
}: {
  sectionId: string;
  sentenceId: string | null;
  root: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const container = root.current;
    if (!container) return;

    const sentences = () =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-sentence-id]'));

    let saved = sentenceId;
    let armed = false;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let arming: ReturnType<typeof setTimeout> | null = null;

    // Arms once scroll events have stopped for `quietMs`. Each scroll restarts
    // the wait, so a smooth resume is ignored for as long as it is still moving,
    // however long a jump deep into a chapter takes.
    const armAfter = (quietMs: number) => {
      if (arming) clearTimeout(arming);
      arming = setTimeout(() => {
        armed = true;
        arming = null;
      }, quietMs);
    };

    // Resume. Not to the first sentence: that is the top of the page, and
    // scrolling there would only hide the title and the chapter list.
    let resuming = false;
    if (sentenceId && !window.location.hash) {
      const target = sentences().find((el) => el.dataset.sentenceId === sentenceId);
      if (target && target !== sentences()[0]) {
        // A tab opened in the background has no frames to animate in, and a
        // smooth scroll there may simply never happen -- nothing to watch
        // anyway, so it jumps.
        const reduce =
          document.hidden ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        // Glides rather than jumps, so you see the page carry you back to your
        // place instead of opening somewhere unexplained. Otherwise a plain
        // `scrollTo(0, y)`: `behavior: 'instant'` is not accepted by every
        // Safari, and a rejected option would throw before any listener below
        // was attached -- no resume and no saving either.
        const top = window.scrollY + firstLineTop(target) - readingLine();
        if (reduce) window.scrollTo(0, top);
        else window.scrollTo({ top, behavior: 'smooth' });
        resuming = true;
      }
    }
    armAfter(ARM_AFTER_MS);
    const save = (keepalive: boolean) => {
      if (timer) clearTimeout(timer);
      timer = null;
      if (!pending) return;
      pending = false;

      const all = sentences();
      const index = currentSentence(all.map(firstLineTop), readingLine() + 1);
      const current = index < 0 ? null : (all[index]!.dataset.sentenceId ?? null);
      if (current === null || current === saved) return;
      saved = current;

      void fetch(`/api/read/${sectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentenceId: current }),
        keepalive,
      }).catch(() => {});
      if (isSupported()) void rememberProgress(sectionId, current).catch(() => {});
    };

    const onScroll = () => {
      if (!armed) {
        // Still gliding back: wait for the motion to stop rather than for a
        // fixed time. Touching the screen mid-glide stops it too, and the
        // scrolling you do after that counts as usual.
        if (resuming) armAfter(RESUME_QUIET_MS);
        return;
      }
      pending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => save(false), SETTLE_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save(true);
    };
    const onPageHide = () => save(true);

    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);

    return () => {
      if (arming) clearTimeout(arming);
      save(true);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
    // Once per section. Following `sentenceId` would scroll you back to where
    // you were a second ago whenever the page re-rendered with a newer value.
  }, [sectionId]);

  return null;
}
