import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-grammar-cache-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { grammarAnalyses, sections, sentences, works } = await import('../../db/schema.ts');
const { analysisVersion, readAnalysis, writeAnalysis } = await import('./cache.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

import type { Identified } from './identify.ts';
import type { GrammarLibrary, GrammarPoint } from './load.ts';

const teiru: GrammarPoint = {
  id: '1351',
  base: 'ている',
  difficulty: 'A1',
  meaningClass: 'x',
  meaningName: 'x',
  nameZh: '～ている（持續）',
  glossZh: '…',
};

/** Only what the cache reads: a point lookup and the stamp. */
const library = (stamp: string, points: GrammarPoint[] = [teiru]) =>
  ({
    point: (id: string) => points.find((p) => p.id === id),
    stamp,
  }) as unknown as GrammarLibrary;

const found: Identified = {
  points: [{ pointId: '1351', point: teiru, charStart: 4, charEnd: 6, surface: 'てい' }],
  others: [{ form: 'よう', name: '～ように（目的）' }],
  answered: true,
};

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
  db.insert(works).values({ id: 'w', title: 't', sourceType: 'text' }).run();
  db.insert(sections)
    .values({ id: 'sec', workId: 'w', orderIndex: 0, analyzerId: 'a', analyzerVersion: '1' })
    .run();
  db.insert(sentences)
    .values({ id: 's1', sectionId: 'sec', orderIndex: 0, text: '雨が降っていた。' })
    .run();
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a stored analysis comes back with its points joined to the inventory', () => {
  writeAnalysis('s1', 0, 'v1', found);
  const hit = readAnalysis('s1', 0, 'v1', library('a'));
  assert.ok(hit);
  assert.equal(hit.points[0]!.point.nameZh, '～ている（持續）');
  assert.equal(hit.points[0]!.surface, 'てい');
  assert.deepEqual(hit.others, found.others);
  assert.equal(hit.answered, true);
});

test('an edited sentence or a changed version is a miss, not a stale answer', () => {
  writeAnalysis('s1', 0, 'v1', found);
  assert.equal(readAnalysis('s1', 1, 'v1', library('a')), null);
  assert.equal(readAnalysis('s1', 0, 'v2', library('a')), null);
});

test('re-analysing replaces the row rather than adding one', () => {
  writeAnalysis('s1', 0, 'v1', found);
  writeAnalysis('s1', 0, 'v1', { points: [], others: [], answered: true });
  assert.deepEqual(readAnalysis('s1', 0, 'v1', library('a'))?.points, []);
  assert.equal(
    db.select().from(grammarAnalyses).where(eq(grammarAnalyses.sentenceId, 's1')).all().length,
    1,
  );
});

test('a point the inventory no longer has is dropped, not shown blank', () => {
  writeAnalysis('s1', 0, 'v1', found);
  assert.deepEqual(readAnalysis('s1', 0, 'v1', library('a', []))?.points, []);
});

test('the version moves with the model and with the inventory', () => {
  const base = analysisVersion('qwen3.8:27b', library('a'));
  assert.equal(analysisVersion('qwen3.8:27b', library('a')), base);
  assert.notEqual(analysisVersion('other:9b', library('a')), base);
  assert.notEqual(analysisVersion('qwen3.8:27b', library('b')), base);
});
