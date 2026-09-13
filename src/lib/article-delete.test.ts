import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

/*
 * Deletion gets its own file, and therefore its own database.
 *
 * `article.test.ts` seeds two works in `before` and several of its tests read
 * the Library's ordering, so a test here that removed one would break them from
 * a distance -- and the failure would look like a bug in sorting.
 */

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-delete-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../db/client.ts');
const { lexemes, sections, sentences, tokens, userLexemeState, works } =
  await import('../db/schema.ts');
const { deleteWork, listArticles } = await import('./article.ts');
const { ingestWork } = await import('./import/ingest.ts');
const { setLearning } = await import('./vocab.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq, sql } = await import('drizzle-orm');

const SAMPLE = ['昨日、図書館で本を三冊借りた。', '今日も本を借りる。'].join('\n');
/** Shares no content word with SAMPLE, so the two works can be told apart. */
const OTHER = '果物屋で林檎を買った。';

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
});

after(() => {
  // Windows will not unlink a database file while the handle is open.
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

function remains(workId: string) {
  const sectionCount = db
    .select({ n: sql<number>`count(*)` })
    .from(sections)
    .where(eq(sections.workId, workId))
    .get();

  const sentenceCount = db
    .select({ n: sql<number>`count(*)` })
    .from(sentences)
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(eq(sections.workId, workId))
    .get();

  const tokenCount = db
    .select({ n: sql<number>`count(*)` })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(eq(sections.workId, workId))
    .get();

  return {
    sections: sectionCount?.n ?? 0,
    sentences: sentenceCount?.n ?? 0,
    tokens: tokenCount?.n ?? 0,
  };
}

const lexemeCount = () =>
  db.select({ n: sql<number>`count(*)` }).from(lexemes).get()?.n ?? 0;

test('takes the work, its sections, its sentences and its tokens', async () => {
  const { workId } = await ingestWork({
    title: '図書館の話',
    sourceType: 'paste',
    sections: [{ body: SAMPLE }],
  });

  const before = remains(workId);
  assert.ok(before.sections > 0 && before.sentences > 0 && before.tokens > 0);

  assert.equal(deleteWork(workId), true);
  assert.deepEqual(remains(workId), { sections: 0, sentences: 0, tokens: 0 });
  assert.equal(db.select().from(works).where(eq(works.id, workId)).get(), undefined);
});

test('never deletes a lexeme, even one left with no occurrences', async () => {
  // The schema is explicit that orphans are never collected: a lexeme is a word
  // you have met, and deleting an article must not quietly unlearn it.
  const { workId } = await ingestWork({
    title: '果物',
    sourceType: 'paste',
    sections: [{ body: OTHER }],
  });

  const before = lexemeCount();
  assert.ok(before > 0);

  deleteWork(workId);
  assert.equal(lexemeCount(), before);
});

test('a word kept as 生詞 outlives the article it was met in', async () => {
  const { workId } = await ingestWork({
    title: '林檎',
    sourceType: 'paste',
    sections: [{ body: OTHER }],
  });

  const met = db
    .select({ id: lexemes.id })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .where(eq(sections.workId, workId))
    .get();

  assert.ok(met);
  setLearning(met.id, true);

  deleteWork(workId);

  const state = db
    .select()
    .from(userLexemeState)
    .where(eq(userLexemeState.lexemeId, met.id))
    .get();
  assert.ok(state, '生詞 state must survive the article');
});

test('leaves every other work alone', async () => {
  const kept = await ingestWork({
    title: '留下',
    sourceType: 'paste',
    sections: [{ body: SAMPLE }],
  });
  const doomed = await ingestWork({
    title: '刪掉',
    sourceType: 'paste',
    sections: [{ body: OTHER }],
  });

  deleteWork(doomed.workId);

  const titles = listArticles().map((article) => article.title);
  assert.ok(titles.includes('留下'));
  assert.ok(!titles.includes('刪掉'));
  assert.ok(remains(kept.workId).tokens > 0);
});

test('a book loses every chapter, not only the one you opened', async () => {
  const { workId } = await ingestWork({
    title: '三章の本',
    sourceType: 'paste',
    sections: [
      { title: '一', body: SAMPLE },
      { title: '二', body: OTHER },
      { title: '三', body: SAMPLE },
    ],
  });

  assert.equal(remains(workId).sections, 3);
  deleteWork(workId);
  assert.equal(remains(workId).sections, 0);
});

test('deleting something already gone is not an error', () => {
  assert.equal(deleteWork('no-such-work'), false);
});
