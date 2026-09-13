import type { Article } from '../article.ts';

/**
 * Downloaded chapters, in IndexedDB.
 *
 * **Data here, shell in the Cache API.** The service worker caches the app's
 * HTML and JavaScript; this holds the chapters. Keeping them apart is what makes
 * a redeploy safe: the shell is replaced wholesale with the new build, while
 * what you downloaded is untouched and build-independent. Caching rendered pages
 * instead would tie your library to the chunk filenames of whichever build
 * happened to be live, and go stale without saying so.
 *
 * Nothing is fetched to save a chapter. The reader is a client component and
 * already holds the whole `Article` -- sentences, tokens, readings, every sense
 * for every word, the 生詞 keys -- so downloading is a copy from memory to disk.
 */

const DB_NAME = 'yomu-offline';
const DB_VERSION = 1;

/** Full payloads, keyed by section. Large: a novel chapter runs to megabytes. */
const CHAPTERS = 'chapters';

/**
 * The same chapters, without their payloads.
 *
 * A separate store rather than a projection, because IndexedDB hands back whole
 * records: listing sixteen downloaded chapters would otherwise mean
 * deserializing sixteen full articles to read sixteen titles.
 */
const SUMMARIES = 'summaries';

export interface OfflineChapter {
  sectionId: string;
  workId: string;
  workTitle: string;
  sectionTitle: string | null;
  author: string | null;
  sentenceCount: number;
  vocabCount: number;
  savedAt: number;
}

interface StoredChapter extends OfflineChapter {
  article: Article;
}

function request<T>(source: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    source.onsuccess = () => resolve(source.result);
    source.onerror = () => reject(source.error);
  });
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, DB_VERSION);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      if (!db.objectStoreNames.contains(CHAPTERS)) {
        db.createObjectStore(CHAPTERS, { keyPath: 'sectionId' });
      }
      if (!db.objectStoreNames.contains(SUMMARIES)) {
        db.createObjectStore(SUMMARIES, { keyPath: 'sectionId' });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

function commit(db: IDBDatabase, tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
    tx.onabort = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB 交易被中止。'));
    };
  });
}

export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export async function saveChapter(article: Article): Promise<OfflineChapter> {
  // Asked once, on the first download. Without it a browser under disk pressure
  // may evict the whole database, and a downloaded novel is exactly the thing
  // you would not want silently discarded.
  await navigator.storage?.persist?.().catch(() => false);

  const summary: OfflineChapter = {
    sectionId: article.sectionId,
    workId: article.workId,
    workTitle: article.workTitle,
    sectionTitle: article.sectionTitle,
    author: article.author,
    sentenceCount: article.sentences.length,
    vocabCount: article.vocabCount,
    savedAt: Date.now(),
  };

  const db = await open();
  const tx = db.transaction([CHAPTERS, SUMMARIES], 'readwrite');
  tx.objectStore(CHAPTERS).put({ ...summary, article } satisfies StoredChapter);
  tx.objectStore(SUMMARIES).put(summary);
  await commit(db, tx);
  return summary;
}

export async function loadChapter(sectionId: string): Promise<Article | null> {
  const db = await open();
  const tx = db.transaction(CHAPTERS, 'readonly');
  const stored = await request<StoredChapter | undefined>(
    tx.objectStore(CHAPTERS).get(sectionId),
  );
  await commit(db, tx);
  return stored?.article ?? null;
}

/** Newest first, which is the order you would look for something you just saved. */
export async function listChapters(): Promise<OfflineChapter[]> {
  const db = await open();
  const tx = db.transaction(SUMMARIES, 'readonly');
  const all = await request<OfflineChapter[]>(tx.objectStore(SUMMARIES).getAll());
  await commit(db, tx);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function storedIds(): Promise<Set<string>> {
  const db = await open();
  const tx = db.transaction(SUMMARIES, 'readonly');
  const keys = await request<IDBValidKey[]>(tx.objectStore(SUMMARIES).getAllKeys());
  await commit(db, tx);
  return new Set(keys.map(String));
}

/**
 * Forgets every downloaded chapter belonging to a work.
 *
 * Called when that work is deleted, by the browser doing the deleting. The
 * server cannot reach IndexedDB, so this is the one moment a device knows both
 * that the article is gone and which of its downloads went with it. Other
 * devices keep their copies until someone builds the reconciliation the plan
 * describes; a stale download is untidy rather than broken, and still reads.
 *
 * The read runs in its own transaction and the deletes in another. Awaiting a
 * request inside a live transaction is the standard way to have IndexedDB
 * auto-commit it out from under you.
 */
export async function deleteWorkChapters(workId: string): Promise<number> {
  const mine = (await listChapters()).filter((c) => c.workId === workId);
  if (mine.length === 0) return 0;

  const db = await open();
  const tx = db.transaction([CHAPTERS, SUMMARIES], 'readwrite');
  for (const chapter of mine) {
    tx.objectStore(CHAPTERS).delete(chapter.sectionId);
    tx.objectStore(SUMMARIES).delete(chapter.sectionId);
  }
  await commit(db, tx);
  return mine.length;
}

export async function deleteChapter(sectionId: string): Promise<void> {
  const db = await open();
  const tx = db.transaction([CHAPTERS, SUMMARIES], 'readwrite');
  tx.objectStore(CHAPTERS).delete(sectionId);
  tx.objectStore(SUMMARIES).delete(sectionId);
  await commit(db, tx);
}
