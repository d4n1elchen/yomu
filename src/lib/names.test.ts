import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// The db client resolves its path at import time, so point it at a scratch
// database before anything pulls it in.
const dir = mkdtempSync(path.join(tmpdir(), 'yomu-names-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../db/client.ts');
const { lexemes, sections, sentences, tokens } = await import('../db/schema.ts');
const { ingestWork } = await import('./import/ingest.ts');
const { addName, listNames, removeName } = await import('./names.ts');
const { getArticle } = await import('./article.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { asc, eq } = await import('drizzle-orm');

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The surfaces of a section's tokens, sentence by sentence. */
function surfaces(sectionId: string): string[] {
  return db
    .select({ surface: tokens.surface })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(asc(sentences.orderIndex), asc(tokens.orderIndex))
    .all()
    .map((row) => row.surface);
}

test('a confirmed name is one token across the work, read from the book ruby', async () => {
  const { sectionIds } = await ingestWork({
    title: '歌鳥',
    sourceType: 'file',
    sections: [
      { title: '一', body: '小笛｜千遥《ちはる》が笑った。' },
      { title: '二', body: '千遥は走った。' },
    ],
  });
  const [first, second] = sectionIds as [string, string];
  assert.ok(surfaces(second).includes('千'), 'split before the name is confirmed');

  // Confirmed from the second chapter, whose text carries no ruby.
  const { sections: rebuilt } = await addName(second, '千遥');
  assert.equal(rebuilt, 2);

  for (const sectionId of [first, second]) {
    assert.ok(surfaces(sectionId).includes('千遥'));
    assert.ok(!surfaces(sectionId).includes('千'));
  }

  const names = listNames();
  assert.equal(names.length, 1);
  assert.equal(names[0]!.surface, '千遥');
  assert.equal(names[0]!.reading, 'チハル');
  assert.equal(names[0]!.occurrences, 2);

  // Not vocabulary: never marked in the reader.
  const article = getArticle(second)!;
  const token = article.sentences[0]!.tokens.find((t) => t.surface === '千遥')!;
  assert.equal(token.contentWord, false);
  assert.equal(token.entryId, null);
});

test('removing a name makes its pieces words again', async () => {
  const [name] = listNames();
  await removeName(name!.lexemeId);

  assert.equal(listNames().length, 0);
  const section = db.select({ id: sections.id }).from(sections).where(eq(sections.title, '二')).get()!;
  assert.ok(surfaces(section.id).includes('千'));
  // The name's lexeme is kept, like every lexeme, but nothing points at it.
  const lexeme = db.select().from(lexemes).where(eq(lexemes.id, name!.lexemeId)).get();
  assert.ok(lexeme);
});

test('a name that is not in the text is refused', async () => {
  const section = db.select({ id: sections.id }).from(sections).where(eq(sections.title, '二')).get()!;
  await assert.rejects(() => addName(section.id, '綾辻'), /找不到/);
  await assert.rejects(() => addName(section.id, ''), /人名/);
});
