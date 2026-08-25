import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-vocab-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../db/client.ts');
const { dictEntries, lexemes } = await import('../db/schema.ts');
const { isLearning, learningCount, learningGroupKeys, setLearning } =
  await import('./vocab.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

const lexeme = (id: string, lemma: string, entryId: string | null) =>
  db
    .insert(lexemes)
    .values({
      id,
      dictionary: 'ipadic',
      lemma,
      reading: '',
      pos: '動詞',
      dictEntryId: entryId,
    })
    .run();

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
  db.insert(dictEntries)
    .values({ id: 'e-miru', common: true, headword: '見る', reading: 'みる' })
    .run();

  // Two spellings of one word -- the Dictionary folds these into a single row.
  lexeme('lex-miru', '見る', 'e-miru');
  lexeme('lex-miru-kana', 'みる', 'e-miru');
  // A word that matched nothing, so it stands alone keyed on itself.
  lexeme('lex-orphan', 'Kubernetes', null);
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a word is not on the list until it is added', () => {
  assert.equal(isLearning('lex-miru'), false);
  assert.equal(learningCount(), 0);
});

test('marking one spelling marks the word, not just that spelling', () => {
  // 見る and みる are one Dictionary row, so they must not disagree here.
  setLearning('lex-miru', true);
  assert.equal(isLearning('lex-miru'), true);
  assert.equal(isLearning('lex-miru-kana'), true, 'the group did not follow');
});

test('the list counts words, not spellings', () => {
  assert.equal(learningCount(), 1);
  assert.deepEqual([...new Set(learningGroupKeys())], ['e-miru']);
});

test('unmarking through the other spelling clears the whole group', () => {
  // The row was written against 見る; removing via みる must still clear it, or
  // the word would stay marked through a spelling never touched.
  setLearning('lex-miru-kana', false);
  assert.equal(isLearning('lex-miru'), false);
  assert.equal(isLearning('lex-miru-kana'), false);
  assert.equal(learningCount(), 0);
});

test('marking twice is not an error and does not double-count', () => {
  setLearning('lex-miru', true);
  setLearning('lex-miru', true);
  assert.equal(learningCount(), 1);
  setLearning('lex-miru', false);
});

test('a word that matched nothing can still be learned, keyed on itself', () => {
  // 36 of 1,207 content words match no entry. They are exactly the words a
  // reader is most likely to want to keep, so they must not be unmarkable.
  setLearning('lex-orphan', true);
  assert.equal(isLearning('lex-orphan'), true);
  assert.deepEqual(learningGroupKeys(), ['lex-orphan']);
  setLearning('lex-orphan', false);
  assert.equal(isLearning('lex-orphan'), false);
});

test('unmarking something never marked is a no-op', () => {
  setLearning('lex-miru', false);
  assert.equal(learningCount(), 0);
});
