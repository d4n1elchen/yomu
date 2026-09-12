/*
 * Offline delivery for Yomu.
 *
 * This worker caches the app's shell -- the /offline document, its JavaScript
 * and its stylesheet. It does NOT cache reading material: chapters live in
 * IndexedDB (src/lib/offline/store.ts), written by the download button while
 * you are online. The split is deliberate. The shell belongs to a build and is
 * replaced wholesale when one lands; a downloaded chapter belongs to you and
 * must survive every deploy.
 *
 * Nothing here caches a page rendered from the database. Every real page is
 * force-dynamic, so a cached copy would be a snapshot that drifts from the
 * server without ever saying so -- a reader that looks live and is not. When
 * the network is gone, this redirects to /offline instead, which reads from
 * IndexedDB and is honest about being a library of what you saved.
 *
 * Bump CACHE when the shell list changes; activate deletes every other cache.
 */

const CACHE = 'yomu-shell-v2';

/**
 * Re-wrap a response so it can be replayed later.
 *
 * `fetch` hands back a **decoded** body while keeping the headers that
 * described the encoded one. Stored verbatim and served back to a navigation,
 * the browser reads `Content-Encoding: gzip` over a body that is already plain
 * HTML and fails the page with a decoding error -- which looks exactly like
 * being offline with nothing cached, and was. `Transfer-Encoding` is worse: it
 * is hop-by-hop and must never be replayed at all.
 *
 * So both go, along with the `Content-Length` that measured the compressed
 * bytes. Everything else -- content type above all -- is kept.
 */
async function storable(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.delete('transfer-encoding');
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** The offline entry point, plus what the manifest points at for an install. */
const SHELL = [
  '/offline',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Individually rather than addAll, which rejects the whole batch if any
      // one entry fails -- an icon 404 must not cost you the offline document.
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const response = await fetch(new Request(path, { cache: 'reload' }));
            if (response.ok) await cache.put(path, await storable(response));
          } catch {
            // Left out of the cache rather than failing the install.
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** Hashed build assets are immutable, so a hit is always correct. */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, await storable(response.clone()));
  }
  return response;
}

/**
 * Network first, because online must never show a stale page. The cached shell
 * exists only for the case where there is no network at all.
 */
async function navigate(request, url) {
  try {
    const response = await fetch(request);
    // Refresh the offline document whenever we happen to load it online, so a
    // device that goes offline after a deploy still boots the current shell.
    if (url.pathname === '/offline' && response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put('/offline', await storable(response.clone()));
    }
    return response;
  } catch {
    const cached = await caches.match('/offline', { ignoreSearch: true });
    if (!cached) throw new Error('offline, and no shell cached');

    // Already heading there: serve it. Anything else becomes a redirect rather
    // than a substituted body, so the address bar and the page agree and the
    // client router is not asked to hydrate one route's HTML at another's URL.
    if (url.pathname === '/offline') return cached;
    return Response.redirect(new URL('/offline', self.location.origin).href, 302);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request, url));
  }

  // Everything else -- server actions, /api/ask, the read stamp -- is left to
  // the network. They need the server by definition, and a cached answer would
  // be worse than a failure the caller already handles.
});
