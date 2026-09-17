'use client';

import { useEffect, useState } from 'react';
import { Reader } from '../../components/Reader.tsx';
import type { Article } from '../../lib/article.ts';
import {
  deleteChapter,
  isSupported,
  listChapters,
  loadChapter,
  type OfflineChapter,
} from '../../lib/offline/store.ts';

/**
 * The offline entry point: a shelf of downloaded chapters, and a reader for one.
 *
 * Client-rendered on purpose, so its HTML is a static document the service
 * worker can cache and serve with no network. Every other page in the app is
 * force-dynamic and rendered from the database, which is exactly what cannot
 * work offline -- this page reads from IndexedDB instead.
 *
 * The chapter is chosen with `?s=`, read from `location` rather than through
 * `useSearchParams`, which would opt the route into dynamic rendering and leave
 * nothing static to cache.
 *
 * Navigation is plain links and full page loads. Offline that is the path the
 * worker already handles -- the request fails, the cached document comes back,
 * and this reads the new `?s=`. A client-side router would be fewer bytes and
 * one more thing to be wrong when it matters most.
 */
export default function OfflinePage() {
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<OfflineChapter[] | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('s');
    setSectionId(wanted);

    if (!isSupported()) {
      setChapters([]);
      return;
    }

    if (wanted) {
      void loadChapter(wanted)
        .then((found) => {
          if (found) setArticle(found);
          else setMissing(true);
        })
        .catch(() => setMissing(true));
      return;
    }

    void listChapters()
      .then(setChapters)
      .catch(() => setChapters([]));
  }, []);

  const forget = async (id: string) => {
    await deleteChapter(id).catch(() => {});
    setChapters(await listChapters().catch(() => []));
  };

  if (sectionId && article) {
    return (
      <main>
        <p className="back">
          <a href="/offline">← 離線書櫃</a>
        </p>
        <p className="work" lang="ja">
          {article.workTitle}
        </p>
        <h1 lang="ja">{article.sectionTitle ?? article.workTitle}</h1>
        <p className="subtitle">
          {article.sentences.length} 個句子 · {article.vocabCount} 個詞 · 離線版本
        </p>
        <Reader article={article} offline />
      </main>
    );
  }

  if (sectionId) {
    return (
      <main className="narrow">
        <p className="back">
          <a href="/offline">← 離線書櫃</a>
        </p>
        <h1>{missing ? '這一章沒有下載' : '載入中…'}</h1>
        {missing ? (
          <p className="subtitle">
            只有下載過的章節能離線閱讀。連上網路後開啟該章，按「下載以離線閱讀」。
          </p>
        ) : null}
      </main>
    );
  }

  return (
    <main>
      <h1>離線書櫃</h1>
      <p className="subtitle">
        已下載的章節，沒有網路也能讀。文法發問需要連線，離線時無法使用。
      </p>

      {chapters === null ? null : chapters.length === 0 ? (
        <p className="empty">
          還沒有下載任何章節。在閱讀頁按「下載以離線閱讀」就會存到這裡。
        </p>
      ) : (
        <div className="library offline-shelf">
          <ul>
            {chapters.map((chapter) => (
              <li key={chapter.sectionId}>
                <a href={`/offline?s=${chapter.sectionId}`}>
                  <span className="title" lang="ja">
                    {chapter.sectionTitle ?? chapter.workTitle}
                    {chapter.sectionTitle ? (
                      <span className="author" lang="ja">
                        {chapter.workTitle}
                      </span>
                    ) : null}
                  </span>
                  <span className="last">{chapter.sentenceCount} 個句子</span>
                  <span className="num">{chapter.vocabCount}</span>
                </a>
                <button
                  type="button"
                  className="link"
                  onClick={() => void forget(chapter.sectionId)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
