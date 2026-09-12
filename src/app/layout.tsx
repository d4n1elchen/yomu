import type { Metadata, Viewport } from 'next';
import { ServiceWorker } from '../components/ServiceWorker.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'Yomu',
  description: '讀日文，累積自己的文章庫與辭典。',
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  /**
   * iOS ignores the manifest's `display`, so a home-screen launch there needs
   * these tags to open without browser chrome. `title` is what appears under
   * the icon; without it iOS uses the page title, which changes per route.
   */
  appleWebApp: {
    capable: true,
    title: 'Yomu',
    statusBarStyle: 'default',
  },
  other: {
    // Next writes only the standardised `mobile-web-app-capable`. iOS 16.4 and
    // later take the standalone mode from the manifest instead, but anything
    // older reads this name and nothing else -- without it those devices open
    // the home-screen icon in a Safari tab with its chrome.
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  /**
   * The paper ground, so the status bar and the page are one surface in a
   * standalone window rather than a white strip above a cream page.
   *
   * Not media-varied on purpose: there is no dark mode here, and `color-scheme:
   * light` in globals.css is what keeps a dark-set OS from painting form
   * controls out from under the design.
   */
  themeColor: '#fbfaf7',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // The chrome is Traditional Chinese; only the material being studied is
    // Japanese, and that carries its own lang where it is rendered.
    <html lang="zh-Hant-TW">
      <body>
        <ServiceWorker />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
