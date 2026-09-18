import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-grammar-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { grammarPoints, sections, sentences, works } = await import('../../db/schema.ts');
const {
  examplesOf,
  keepGrammarPoint,
  keptCount,
  keptPoints,
  keptStates,
  releaseGrammarPoint,
} = await import('./library.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

const point = (id: string, base: string) =>
  db
    .insert(grammarPoints)
    .values({
      id,
      base,
      difficulty: 'A2',
      meaningClass: 'x',
      meaningName: 'x',
      nameZh: `～${base}`,
      glossZh: '…',
    })
    .run();

const sentence = (id: string, text: string, order: number) =>
  db
    .insert(sentences)
    .values({ id, sectionId: 'sec', orderIndex: order, text })
    .run();

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
  db.insert(works).values({ id: 'w', title: 't', sourceType: 'text' }).run();
  db.insert(sections)
    .values({ id: 'sec', workId: 'w', orderIndex: 0, analyzerId: 'a', analyzerVersion: '1' })
    .run();
  sentence('s1', '本を読んでいる。', 0);
  sentence('s2', '雨が降っていた。', 1000);
  point('1351', 'ている');
  point('0011', 'にとって');
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const example = (pointId: string, sentenceId: string, charStart: number, charEnd: number) => ({
  pointId,
  sentenceId,
  sentenceRevision: 0,
  charStart,
  charEnd,
  surface: 'x',
});

test('nothing is kept until a card is added', () => {
  assert.equal(keptCount(), 0);
  assert.deepEqual(keptStates(['1351'], 's1').get('1351'), {
    kept: false,
    examples: 0,
    thisSentence: false,
  });
});

test('adding keeps the point with the sentence as its first example', () => {
  keepGrammarPoint(example('1351', 's1', 4, 7));
  assert.equal(keptCount(), 1);
  assert.deepEqual(keptStates(['1351'], 's1').get('1351'), {
    kept: true,
    examples: 1,
    thisSentence: true,
  });
});

test('the same point from another sentence is one entry with two examples', () => {
  // ～ていた here, ～ている there: different spellings of one point, filed
  // under one key. This is the dedup the whole design exists for.
  keepGrammarPoint(example('1351', 's2', 3, 5));
  assert.equal(keptCount(), 1);
  const state = keptStates(['1351'], 's2').get('1351');
  assert.equal(state?.examples, 2);
  assert.equal(examplesOf('1351').length, 2);
});

test('adding the same example twice is not a second example', () => {
  keepGrammarPoint(example('1351', 's1', 4, 7));
  assert.equal(examplesOf('1351').length, 2);
});

test('a point the inventory does not have cannot be kept', () => {
  // The card only offers inventory ids; anything else did not come from one,
  // and letting it in would be a model-named entry through the back door.
  assert.throws(() => keepGrammarPoint(example('nonsense', 's1', 0, 1)));
  assert.equal(keptCount(), 1);
});

test('re-importing つつじ does not empty the library', () => {
  // The import rebuilds grammar_point from scratch. With a cascade from it,
  // every kept point would go with it -- which is why the library has no
  // foreign key to it at all.
  db.delete(grammarPoints).run();
  assert.equal(keptCount(), 1);
  point('1351', 'ている');
  point('0011', 'にとって');
  assert.equal(keptPoints()[0]?.base, 'ている');
});

test('a point whose row has gone still lists, under its id', () => {
  db.delete(grammarPoints).where(eq(grammarPoints.id, '1351')).run();
  assert.equal(keptPoints()[0]?.base, '1351');
  point('1351', 'ている');
});

test('an edited sentence makes its example stale rather than wrong', () => {
  db.update(sentences).set({ revision: 1 }).where(eq(sentences.id, 's2')).run();
  const stale = examplesOf('1351').find((e) => e.sentenceId === 's2');
  assert.equal(stale?.stale, true);
  const fresh = examplesOf('1351').find((e) => e.sentenceId === 's1');
  assert.equal(fresh?.stale, false);
});

test('removing a point takes its examples with it', () => {
  releaseGrammarPoint('1351');
  assert.equal(keptCount(), 0);
  assert.equal(examplesOf('1351').length, 0);
});

test('deleting a sentence removes its examples but not the point', () => {
  keepGrammarPoint(example('0011', 's1', 0, 4));
  db.delete(sentences).where(eq(sentences.id, 's1')).run();
  // The same choice as for 生詞: deleting an article does not unlearn.
  assert.equal(keptCount(), 1);
  assert.equal(examplesOf('0011').length, 0);
});
