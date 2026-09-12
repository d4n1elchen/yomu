'use client';

import { useEffect } from 'react';

/**
 * Registers the offline worker, in production only.
 *
 * Not in development, and that is not caution: the dev server's chunk URLs are
 * rewritten on every edit, so a worker caching them would serve yesterday's
 * JavaScript and hot reload would fight it. Verify offline against `npm run
 * build && npm start`, where the URLs are the hashed ones the worker is written
 * for.
 *
 * Registration is silent. A worker is an optimisation for a reader who is
 * offline later; failing to install one is not something to interrupt anybody
 * about now, and every browser that refuses -- an insecure origin, private
 * browsing -- refuses for a reason the reader cannot act on.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    // Development shares an origin with the production build on this machine, so
    // a worker installed by `npm start` would still be controlling the page
    // under `npm run dev` -- serving one build's cached chunks to another's
    // HTML. Tearing it down here makes `npm run dev` the way back from any
    // offline state, rather than a trip through the browser's settings.
    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker
        .getRegistrations()
        .then((workers) => Promise.all(workers.map((worker) => worker.unregister())))
        .catch(() => {});
      return;
    }

    // Service workers only register in a secure context. Over plain HTTP on a
    // LAN address this is false and the call would throw; localhost is exempt.
    if (!window.isSecureContext) return;

    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
