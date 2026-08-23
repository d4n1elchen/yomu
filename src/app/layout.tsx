import type { Metadata } from 'next';
import { SiteHeader } from '../components/SiteHeader.tsx';
import './globals.css';

export const metadata: Metadata = {
  title: 'Yomu',
  description: '讀日文，累積自己的文章庫與辭典。',
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
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
