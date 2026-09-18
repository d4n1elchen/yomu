'use client';

import { usePathname } from 'next/navigation';

/**
 * Three places to be — the Library of articles, the Dictionary of words and
 * grammar, and Review of what you kept — plus the way in. Adding an article is
 * its own page rather than a dialog, so this is a link like any other.
 */
export function SiteHeader() {
  const pathname = usePathname() ?? '/';

  // Reading an article is being in the Library, as far as orientation goes.
  const inLibrary =
    pathname === '/' ||
    pathname.startsWith('/library') ||
    pathname.startsWith('/read');
  const inDictionary = pathname.startsWith('/dictionary');
  const inReview = pathname.startsWith('/review');

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="brand" href="/library">
          読む
        </a>
        <nav className="tabs">
          <a className={inLibrary ? 'active' : ''} href="/library">
            文章庫
          </a>
          <a className={inDictionary ? 'active' : ''} href="/dictionary">
            辭典
          </a>
          <a className={inReview ? 'active' : ''} href="/review">
            複習
          </a>
        </nav>
        <a className="new-article" href="/new">
          <span aria-hidden="true">＋</span> 新增文章
        </a>
      </div>
    </header>
  );
}
