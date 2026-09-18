import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'yomu-quiz-'));
process.env.YOMU_DB_PATH = path.join(dir, 'test.db');

const { db, sqlite } = await import('../../db/client.ts');
const { grammarPoints, sections, sentences, userGrammarState, works } = await import(
  '../../db/schema.ts'
);
const { keepGrammarPoint } = await import('./library.ts');
const { answerGrammarQuestion, dueGrammarCount, nextGrammarQuestion, questionFor } =
  await import('./quiz.ts');
const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
const { eq } = await import('drizzle-orm');

const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;

const point = (id: string, base: string, meaningClass: string, difficulty = 'A2') =>
  db
    .insert(grammarPoints)
    .values({
      id,
      base,
      difficulty,
      meaningClass,
      meaningName: meaningClass,
      nameZh: `～${base}（${id}）`,
      glossZh: `說明 ${id}`,
    })
    .run();

before(() => {
  migrate(db, { migrationsFolder: './drizzle' });
  db.insert(works).values({ id: 'w', title: '本', sourceType: 'text' }).run();
  db.insert(sections)
    .values({ id: 'sec', workId: 'w', orderIndex: 0, analyzerId: 'a', analyzerVersion: '1' })
    .run();
  db.insert(sentences)
    .values({ id: 's1', sectionId: 'sec', orderIndex: 0, text: '勝つために練習する。' })
    .run();
  db.insert(sentences)
    .values({ id: 's2', sectionId: 'sec', orderIndex: 1000, text: '雨のために中止した。' })
    .run();

  // ために twice -- reason and purpose, the confusion a question should test --
  // plus a paraphrase of the purpose meaning (same class) and unrelated points.
  point('0731', 'ために', 'reason');
  point('0732', 'ために', 'purpose');
  point('1871', 'ようにする', 'purpose');
  point('1351', 'ている', 'aspect');
  point('0011', 'にとって', 'standpoint');
  point('0091', 'について', 'topic');

  keepGrammarPoint({
    pointId: '0732',
    sentenceId: 's1',
    sentenceRevision: 0,
    charStart: 2,
    charEnd: 5,
    surface: 'ために',
  });
});

after(() => {
  sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a kept point is due at once', () => {
  assert.equal(dueGrammarCount(NOW), 1);
  assert.equal(nextGrammarQuestion(NOW)?.pointId, '0732');
});

test('the question is asked on your own sentence, with the span marked', () => {
  const q = questionFor('0732', NOW)!;
  assert.equal(q.sentence, '勝つために練習する。');
  assert.equal(q.sentence.slice(q.charStart, q.charEnd), 'ために');
  assert.equal(q.workTitle, '本');
});

test('the wrong answers start with the same form, other meaning', () => {
  // ために "because" is the confusion a reader of ために "in order to" has, and
  // the sentence is what settles it.
  const ids = questionFor('0732', NOW)!.choices.map((c) => c.pointId);
  assert.equal(ids.length, 4);
  assert.ok(ids.includes('0732'), 'the right answer is offered');
  assert.ok(ids.includes('0731'), 'the other meaning of the same form is offered');
});

test('a paraphrase of the point is never a wrong answer', () => {
  // ようにする shares the purpose class with ために: offered as "wrong", it
  // would mark a right answer wrong.
  const ids = questionFor('0732', NOW)!.choices.map((c) => c.pointId);
  assert.ok(!ids.includes('1871'));
});

test('the answer order holds across a reload', () => {
  assert.deepEqual(questionFor('0732', NOW), questionFor('0732', NOW + 60));
});

test('a right answer schedules the point out a day', () => {
  assert.deepEqual(answerGrammarQuestion('0732', '0732', NOW), { correct: true });
  assert.equal(dueGrammarCount(NOW), 0);
  assert.equal(dueGrammarCount(NOW + DAY), 1);
});

test('answering a point that is not due does not count again', () => {
  // A stale page submitting twice must not climb the point two boxes.
  answerGrammarQuestion('0732', '0732', NOW + 5);
  const state = db
    .select()
    .from(userGrammarState)
    .where(eq(userGrammarState.pointId, '0732'))
    .get();
  assert.equal(state?.familiarity, 1);
});

test('a wrong answer comes back within the sitting', () => {
  const later = NOW + DAY;
  assert.deepEqual(answerGrammarQuestion('0732', '0731', later), { correct: false });
  assert.equal(dueGrammarCount(later), 0);
  assert.equal(dueGrammarCount(later + 10 * 60), 1);
});

test('a point with no usable sentence waits rather than being asked blind', () => {
  db.update(sentences).set({ revision: 1 }).where(eq(sentences.id, 's1')).run();
  assert.equal(questionFor('0732', NOW + 2 * DAY), null);
  assert.equal(nextGrammarQuestion(NOW + 2 * DAY), null);
});

test('a choice never names its own form', () => {
  // With the form in the text, the right answer is the choice that starts with
  // the form the question names -- every question answers itself.
  db.update(sentences).set({ revision: 0 }).where(eq(sentences.id, 's1')).run();
  for (const choice of questionFor('0732', NOW + 3 * DAY)!.choices) {
    assert.doesNotMatch(choice.text, /[～ぁ-ん]/u, choice.text);
  }
});
