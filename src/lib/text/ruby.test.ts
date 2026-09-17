import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractRuby, rubyMarkup, spansWithin } from './ruby.ts';

test('explicit markup gives the base as text and the reading as a span', () => {
  const { text, spans } = extractRuby('小笛｜千遥《ちはる》が笑った。');
  assert.equal(text, '小笛千遥が笑った。');
  assert.deepEqual(spans, [{ start: 2, end: 4, reading: 'ちはる' }]);
});

test('without a bar the base is the run of kanji before the bracket', () => {
  const { text, spans } = extractRuby('彼は頷《うなず》いた。');
  assert.equal(text, '彼は頷いた。');
  assert.deepEqual(spans, [{ start: 2, end: 3, reading: 'うなず' }]);
});

test('an explicit ruby may gloss rather than read', () => {
  const { text, spans } = extractRuby('｜ＩＣＵ《集中治療室》のような部屋');
  assert.equal(text, 'ＩＣＵのような部屋');
  assert.deepEqual(spans, [{ start: 0, end: 3, reading: '集中治療室' }]);
});

test('a bracket that holds no reading is text, as in a title', () => {
  const marked = '《源氏物語》を読んだ。｜本《》';
  assert.deepEqual(extractRuby(marked), { text: marked, spans: [] });
});

test('offsets account for every earlier ruby removed', () => {
  const marked = `${rubyMarkup('化', 'か')}と${rubyMarkup('歩', 'ふ')}`;
  const { text, spans } = extractRuby(marked);
  assert.equal(text, '化と歩');
  assert.deepEqual(spans, [
    { start: 0, end: 1, reading: 'か' },
    { start: 2, end: 3, reading: 'ふ' },
  ]);
});

test('spans are handed to the sentence that holds them, rebased', () => {
  const spans = [
    { start: 1, end: 3, reading: 'あ' },
    { start: 5, end: 7, reading: 'い' },
  ];
  assert.deepEqual(spansWithin(spans, 4, 10), [{ start: 1, end: 3, reading: 'い' }]);
  assert.deepEqual(spansWithin(spans, 2, 6), []);
});
