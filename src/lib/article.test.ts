import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-article-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../db/client.ts');
const { sections } = await import('../db/schema.ts');
const { ingestWork } = await import('./import/ingest.ts');
const { getArticle, listArticles, stampLastRead } = await import('./article.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

let readingId = '';
let bookIds: string[] = [];

before(async () => {
  migrate(db, { migrationsFolder: './drizzle' });

  const reading = await ingestWork({
    title: '読書',
    sourceType: 'paste',
    sections: [{ body: '昨日、図書館で本を三冊借りた。' }],
  });
  readingId = reading.sectionIds[0]!;

  const book = await ingestWork({
    title: '三四郎',
    sourceType: 'paste',
    sections: [
      { title: '第一章', body: 'まだ半分しか読んでいない。' },
      { title: '第二章', body: '来週までには全部読み終わるつもりだ。' },
    ],
  });
  bookIds = book.sectionIds;
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const find = (title: string) => listArticles().find((a) => a.title === title)!;

test('token offsets are relative to the sentence they render in', () => {
  const article = getArticle(readingId)!;
  for (const sentence of article.sentences) {
    for (const token of sentence.tokens) {
      assert.equal(
        sentence.text.slice(token.charStart, token.charEnd),
        token.surface,
      );
      // The reader needs the owning sentence on every token to map a browser
      // selection back onto these offsets.
      assert.equal(token.sentenceId, sentence.id);
    }
  }
});

test('lists one row per work, not per section', () => {
  const titles = listArticles().map((a) => a.title);
  assert.deepEqual([...titles].sort(), ['三四郎', '読書']);
});

test('counts vocabulary the way the Dictionary counts it', () => {
  // 昨日 図書館 本 三 冊 借り -- content words only, no particles, no 。
  assert.equal(find('読書').vocabCount, 6);
});

test('the reader header and the Library row agree on the vocabulary count', () => {
  // They sit under labels a reader reads as the same word. Counting every
  // token in one place and distinct content words in the other put 78 next to
  // 34 for the same article.
  assert.equal(getArticle(readingId)!.vocabCount, find('読書').vocabCount);
});

test('the reader counts its own section, not the whole work', () => {
  const [one, two] = bookIds.map((id) => getArticle(id)!.vocabCount);
  assert.ok(one > 0 && two > 0);
  // A chapter's header speaks for the chapter; the Library row speaks for the
  // book, so the row is the larger number.
  assert.ok(find('三四郎').vocabCount > Math.max(one, two));
});

test('an unread work reports no reading time rather than a fake one', () => {
  assert.equal(find('読書').lastReadAt, null);
});

test('a work reports the most recent read across its sections', () => {
  const now = Math.floor(Date.now() / 1000);
  db.update(sections)
    .set({ lastReadAt: now - 500 })
    .where(eq(sections.id, bookIds[0]!))
    .run();
  db.update(sections)
    .set({ lastReadAt: now - 100 })
    .where(eq(sections.id, bookIds[1]!))
    .run();

  const book = find('三四郎');
  assert.equal(book.lastReadAt, now - 100);
  // And opening it resumes at the chapter you were last in.
  assert.equal(book.sectionId, bookIds[1]);
});

test('a just-imported article outranks one read hours ago', () => {
  // Nothing has opened 読書 yet, so it sorts on its import time. Sorting
  // unread work to the bottom would bury every new import under the backlog.
  assert.equal(listArticles()[0]!.title, '読書');
});

test('stamping records the section and is reported by its work', () => {
  assert.equal(stampLastRead(readingId), true);
  assert.notEqual(find('読書').lastReadAt, null);
});

test('reading a work brings it to the top of the Library', () => {
  assert.equal(stampLastRead(bookIds[0]!), true);
  assert.equal(listArticles()[0]!.title, '三四郎');
  // ...and the row now resumes at the chapter just read, not the later one.
  assert.equal(find('三四郎').sectionId, bookIds[0]);
});

test('stamping a section that does not exist says so instead of inventing one', () => {
  assert.equal(stampLastRead('no-such-section'), false);
});
