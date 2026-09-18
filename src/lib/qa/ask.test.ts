import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-ask-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { grammarPoints, sections, sentences } = await import('../../db/schema.ts');
const { loadAskContext, resolveAskGrammar } = await import('./ask.ts');
const { ingestWork } = await import('../import/ingest.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { asc, eq } = await import('drizzle-orm');

let chapterOne: string[] = [];
let chapterTwo: string[] = [];

function sentenceIds(sectionId: string): string[] {
  return db
    .select({ id: sentences.id })
    .from(sentences)
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(asc(sentences.orderIndex))
    .all()
    .map((row) => row.id);
}

before(async () => {
  migrate(db, { migrationsFolder: './drizzle' });
  const { workId } = await ingestWork({
    title: '雨の日',
    sourceType: 'paste',
    sections: [
      // A paragraph break after the second sentence: a neighbour crosses it.
      { body: '雨が降っていた。窓の外を眺めた。\nそれから本を読んだ。' },
      { body: '翌朝は晴れた。' },
    ],
  });
  const ids = db
    .select({ id: sections.id })
    .from(sections)
    .where(eq(sections.workId, workId))
    .orderBy(asc(sections.orderIndex))
    .all();
  chapterOne = sentenceIds(ids[0]!.id);
  chapterTwo = sentenceIds(ids[1]!.id);
});

after(() => {
  // Windows will not unlink a database file while the handle is open.
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a sentence comes with the ones either side, across a paragraph break', () => {
  const context = loadAskContext(chapterOne[1]!);
  assert.equal(context.target.text, '窓の外を眺めた。');
  assert.equal(context.previous, '雨が降っていた。');
  assert.equal(context.next, 'それから本を読んだ。');
  assert.ok(context.target.tokens.some((t) => t.surface === '窓'));
});

test('a neighbour never crosses into another chapter', () => {
  assert.equal(loadAskContext(chapterOne[0]!).previous, null);
  assert.equal(loadAskContext(chapterOne[2]!).next, null);

  const opening = loadAskContext(chapterTwo[0]!);
  assert.equal(opening.previous, null);
  assert.equal(opening.next, null);
});

test('an unknown sentence is refused', () => {
  assert.throws(() => loadAskContext('missing'), /Sentence not found/);
});

test("the card's grammar reaches the prompt in the inventory's words, not the client's", () => {
  db.insert(grammarPoints)
    .values([
      {
        id: '0620',
        base: 'ている',
        difficulty: 'A2',
        meaningClass: 'x',
        meaningName: 'x',
        nameZh: '～ている（持續）',
        glossZh: '表示動作或狀態持續中。',
      },
      // Not yet glossed: there is nothing reviewed to tell the model.
      { id: '0999', base: 'た', difficulty: 'A2', meaningClass: 'y', meaningName: 'y' },
    ])
    .run();

  const lines = resolveAskGrammar('雨が降っていた。', [
    { pointId: '0620', surface: 'てい' },
    { pointId: '0620', surface: 'てい' },
    { pointId: '0999', surface: 'た' },
    { pointId: 'yomu:made-up', surface: 'て' },
    { pointId: '0620', surface: '見ている' },
  ]);
  assert.deepEqual(lines, [
    { surface: 'てい', name: '～ている（持續）', gloss: '表示動作或狀態持續中。' },
  ]);
});
