import { after } from 'next/server';
import { ensureDraining } from '../../lib/analysis/drain.ts';
import { listArticles } from '../../lib/article.ts';
import { relativeTime } from '../../lib/time.ts';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const articles = listArticles();

  // Restart recovery. A drain interrupted by a server restart leaves sections
  // unresolved and senses untranslated, and nothing else would ever pick them
  // up. Opening the Library -- where a stalled article is visibly waiting -- is
  // the natural moment to resume. `ensureDraining` is a no-op when one is
  // already running or the host was just found down, so this is safe to fire on
  // every render.
  after(ensureDraining);

  return (
    <main>
      <h1>文章庫</h1>

      {articles.length === 0 ? (
        <p className="empty">
          還沒有文章。<a href="/new">新增一篇</a>，詞彙就會開始累積到辭典裡。
        </p>
      ) : (
        <div className="library">
          <div className="library-head" aria-hidden="true">
            <span>標題</span>
            <span>最近閱讀</span>
            <span className="num">詞彙</span>
            <span className="num">文法</span>
          </div>

          <ul>
            {articles.map((article) => {
              const title = (
                <span className="title" lang="ja">
                  {article.title}
                  {article.author ? (
                    <span className="author">{article.author}</span>
                  ) : null}
                </span>
              );
              const counts = (
                <>
                  <span className="num">{article.vocabCount}</span>
                  {/* Grammar reads zero until grammar has a natural key. */}
                  <span className="num zero">0</span>
                </>
              );

              // Still analysing: a span rather than a link, so there is nothing
              // to click. The row is not hidden -- the article exists and its
              // vocabulary is already counted; it just cannot be opened until
              // the links stop moving.
              return (
                <li key={article.workId}>
                  {article.analysis ? (
                    <span className="pending" aria-disabled="true">
                      {title}
                      <span className="last analysing">
                        分析中
                        {article.analysis.total > 0
                          ? ` ${article.analysis.done}/${article.analysis.total}`
                          : ''}
                      </span>
                      {counts}
                    </span>
                  ) : (
                    <a href={`/read/${article.sectionId}`}>
                      {title}
                      <span className="last">
                        {relativeTime(article.lastReadAt)}
                      </span>
                      {counts}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>

          <p className="note">
            文法一律顯示 0 — 在找到自然鍵之前暫緩實作。
          </p>
        </div>
      )}
    </main>
  );
}
