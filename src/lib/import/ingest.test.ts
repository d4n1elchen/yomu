import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The db client resolves its path at import time, so point it at a scratch
// database before anything pulls it in.
const dir = mkdtempSync(path.join(tmpdir(), 'yomu-test-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { lexemes, sections, sentences, tokens, works } = await import(
  '../../db/schema.ts'
);
const { ingestWork } = await import('./ingest.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { and, eq, sql } = await import('drizzle-orm');

const SAMPLE = [
  '昨日、図書館で本を三冊借りた。',
  '「面白い！」と言ったが、まだ読んでいない。',
  '今日も本を借りる。',
].join('\n');

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
});

after(() => {
  // Windows will not unlink a database file while the handle is open.
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('imports a pasted article as a one-section work', async () => {
  const { workId, sectionIds } = await ingestWork({
    title: '図書館の話',
    sourceType: 'paste',
    sections: [{ body: SAMPLE }],
  });

  assert.equal(sectionIds.length, 1);

  const work = db.select().from(works).where(eq(works.id, workId)).get();
  assert.equal(work?.title, '図書館の話');
  assert.equal(work?.sourceType, 'paste');

  const section = db
    .select()
    .from(sections)
    .where(eq(sections.id, sectionIds[0]!))
    .get();
  // Provenance must be recorded, or a later dictionary swap is unrecoverable.
  assert.equal(section?.analyzerId, 'kuromoji-ipadic');
  assert.equal(section?.editState, 'editable');
  assert.equal(section?.sourceText, SAMPLE);

  const rows = db
    .select()
    .from(sentences)
    .where(eq(sentences.sectionId, sectionIds[0]!))
    .all();
  assert.equal(rows.length, 3);
  assert.equal(rows.every((r) => r.revision === 0), true);
  // Sparse ordering, so a transcript fix can split a sentence in place.
  assert.deepEqual(
    rows.map((r) => r.orderIndex).sort((a, b) => a - b),
    [1000, 2000, 3000],
  );
});

test('every token offset selects its own surface from its sentence', () => {
  const rows = db
    .select({
      text: sentences.text,
      surface: tokens.surface,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
    })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .all();

  assert.ok(rows.length > 0, 'no tokens were written');
  for (const row of rows) {
    assert.equal(
      row.text.slice(row.charStart, row.charEnd),
      row.surface,
      `offset mismatch for ${row.surface} in ${row.text}`,
    );
  }
});

test('inflected forms collapse under one dictionary form', () => {
  // 借りた and 借りる are different surfaces of the same lexeme; if the lemma
  // reading were taken from the surface they would split into two entries.
  const borrow = db
    .select({ id: lexemes.id, reading: lexemes.reading })
    .from(lexemes)
    .where(and(eq(lexemes.lemma, '借りる'), eq(lexemes.pos, '動詞')))
    .all();

  assert.equal(borrow.length, 1, 'lemma fragmented into multiple lexemes');
  assert.equal(borrow[0]!.reading, 'カリル');

  const surfaces = db
    .select({ surface: tokens.surface })
    .from(tokens)
    .where(eq(tokens.lexemeId, borrow[0]!.id))
    .all()
    .map((r) => r.surface);

  assert.deepEqual([...new Set(surfaces)].sort(), ['借り', '借りる']);
});

test('the Library occurrence query returns every place a word appeared', () => {
  const occurrences = db
    .select({ lemma: lexemes.lemma, sentence: sentences.text })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(eq(lexemes.lemma, '本'))
    .all();

  assert.equal(occurrences.length, 2);
});

test('re-importing the same text reuses lexemes instead of duplicating them', async () => {
  const countLexemes = () =>
    db.select({ n: sql<number>`count(*)` }).from(lexemes).get()!.n;

  const before = countLexemes();
  await ingestWork({
    title: '図書館の話（再）',
    sourceType: 'paste',
    sections: [{ body: SAMPLE }],
  });

  assert.equal(countLexemes(), before, 'lexeme rows were duplicated');
});

test('a transcript section is marked for review, a pasted one is not', async () => {
  const { sectionIds } = await ingestWork({
    title: '書き起こし',
    sourceType: 'transcript',
    sections: [{ body: '本を読む。', origin: 'transcript' }],
  });

  const section = db
    .select()
    .from(sections)
    .where(eq(sections.id, sectionIds[0]!))
    .get();
  assert.equal(section?.origin, 'transcript');
  assert.equal(section?.editState, 'needs_review');

  const rows = db
    .select()
    .from(sentences)
    .where(eq(sentences.sectionId, sectionIds[0]!))
    .all();
  // Words nobody has read yet must not silently become vocabulary.
  assert.equal(rows.every((r) => r.needsReview), true);
});
