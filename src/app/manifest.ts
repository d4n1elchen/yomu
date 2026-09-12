import type { MetadataRoute } from 'next';

/**
 * Installable to a home screen, and that is the whole of what this buys.
 *
 * There is deliberately **no service worker**, because offline would be a lie.
 * Every page is `force-dynamic` and rendered from the SQLite file on the
 * server; the word cards, the Q&A and the drain all need it. A worker could
 * cache the shell and then show you an empty one, which is worse than the
 * browser's own "no connection" page because it looks like the app working.
 *
 * Chrome's install prompt wants a worker and a secure context, and the app is
 * served over plain HTTP on a LAN address, which is neither. iOS does not care:
 * `appleWebApp` in the layout gets a standalone window there today. On Android
 * this still supplies the name and icon for "add to home screen".
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Yomu',
    short_name: 'Yomu',
    description: '讀日文，累積自己的文章庫與辭典。',
    // Straight to the Library. `/` only redirects there, and paying for a
    // round trip on every launch is exactly what a home-screen icon is for
    // avoiding.
    start_url: '/library',
    scope: '/',
    display: 'standalone',
    // The warm paper ground, which is the design. `background_color` is what
    // Android paints behind the splash before the first render, so anything
    // else here would flash a colour the app never shows.
    background_color: '#fbfaf7',
    theme_color: '#fbfaf7',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // The same file, declared separately rather than as "any maskable": the
      // glyph is drawn at half the canvas, well inside the centre 80% a mask
      // can crop to, so it survives a circle as well as a square.
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
