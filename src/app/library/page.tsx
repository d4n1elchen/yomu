import { after } from 'next/server';
import { AnalysisPoller } from '../../components/AnalysisPoller.tsx';
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

  const analysing = articles.some((article) => article.analysis !== null);

  return (
    <main>
      <h1>文章庫</h1>
      {/* Only while something is pending; it unmounts when the last one lands. */}
      {analysing ? <AnalysisPoller /> : null}

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
                  {/* A book's row speaks for all of its chapters, and says so.
                      One section is an article and needs no count. */}
                  {article.sectionCount > 1 ? (
                    <span className="chapter-count">共 {article.sectionCount} 章</span>
                  ) : null}
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

              // Progress displaces the last-read time while anything in the work
              // is still resolving -- it is the more urgent of the two, and they
              // share a column. A book shows both states at once: chapter one
              // open, chapter twelve still being analysed.
              const status = article.analysis ? (
                <span
                  className="analysing"
                  role="progressbar"
                  aria-valuenow={article.analysis.done}
                  aria-valuemin={0}
                  aria-valuemax={article.analysis.total}
                  aria-label="分析進度"
                >
                  <span className="analysing-label">
                    <span>分析中</span>
                    {article.analysis.total > 0 ? (
                      <span>
                        {Math.floor(
                          (article.analysis.done / article.analysis.total) * 100,
                        )}
                        %
                      </span>
                    ) : null}
                  </span>
                  <span className="analysing-bar">
                    <span
                      className={
                        article.analysis.total > 0
                          ? 'analysing-fill'
                          : 'analysing-fill indeterminate'
                      }
                      style={{
                        ['--progress' as string]:
                          article.analysis.total > 0
                            ? article.analysis.done / article.analysis.total
                            : 0,
                      }}
                    />
                  </span>
                </span>
              ) : (
                <span className="last">{relativeTime(article.lastReadAt)}</span>
              );

              // Not readable: a span rather than a link, so there is nothing to
              // click. The row is not hidden -- the work exists and its
              // vocabulary is already counted; the chapter it would open just
              // cannot be read until that chapter's links stop moving.
              return (
                <li key={article.workId}>
                  {article.readable ? (
                    <a href={`/read/${article.sectionId}`}>
                      {title}
                      {status}
                      {counts}
                    </a>
                  ) : (
                    <span className="pending" aria-disabled="true">
                      {title}
                      {status}
                      {counts}
                    </span>
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
