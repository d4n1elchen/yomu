import { listArticles } from '../../lib/article.ts';
import { relativeTime } from '../../lib/time.ts';

export const dynamic = 'force-dynamic';

export default function LibraryPage() {
  const articles = listArticles();

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
            {articles.map((article) => (
              <li key={article.workId}>
                <a href={`/read/${article.sectionId}`}>
                  <span className="title" lang="ja">
                    {article.title}
                    {article.author ? (
                      <span className="author">{article.author}</span>
                    ) : null}
                  </span>
                  <span className="last">{relativeTime(article.lastReadAt)}</span>
                  <span className="num">{article.vocabCount}</span>
                  {/* Grammar reads zero until grammar has a natural key. */}
                  <span className="num zero">0</span>
                </a>
              </li>
            ))}
          </ul>

          <p className="note">
            文法一律顯示 0 — 在找到自然鍵之前暫緩實作。
          </p>
        </div>
      )}
    </main>
  );
}
