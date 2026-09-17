import assert from 'node:assert/strict';
import { test } from 'node:test';
import { kuromojiAnalyzer } from '../analyzer/kuromoji.ts';
import { applyNames, NAME_DICTIONARY, rubyReadingOf } from './names.ts';

test('a confirmed name becomes one token wherever it aligns with tokens', async () => {
  const text = '小笛千遥が笑った。千遥は。';
  const tokens = applyNames(text, await kuromojiAnalyzer.analyze(text), [
    { surface: '千遥', reading: 'ちはる' },
  ]);
  const names = tokens.filter((t) => t.dictionary === NAME_DICTIONARY);
  assert.equal(names.length, 2);
  assert.deepEqual(
    names.map((t) => [t.surface, t.charStart, t.charEnd, t.lemmaReading, t.reading]),
    [
      ['千遥', 2, 4, 'チハル', 'チハル'],
      ['千遥', 9, 11, 'チハル', 'チハル'],
    ],
  );
  // Still end to end, with nothing lost or duplicated.
  let cursor = 0;
  for (const token of tokens) {
    assert.equal(token.charStart, cursor);
    cursor = token.charEnd;
  }
  assert.equal(cursor, text.length);
});

test('an occurrence that cuts through a token is left as analysed', async () => {
  // 京都に starts inside the token 東京.
  const text = '東京都に住む。';
  const analyzed = await kuromojiAnalyzer.analyze(text);
  const tokens = applyNames(text, analyzed, [{ surface: '京都に', reading: null }]);
  assert.deepEqual(tokens, analyzed);
});

test('a name without a reading carries none', async () => {
  const text = '千遥が来た。';
  const [name] = applyNames(text, await kuromojiAnalyzer.analyze(text), [
    { surface: '千遥', reading: null },
  ]);
  assert.equal(name!.lemmaReading, '');
  assert.equal(name!.reading, null);
});

test('the book ruby reading of a name, whole or tiled', () => {
  assert.equal(rubyReadingOf('小笛千遥が', [{ start: 2, end: 4, reading: 'ちはる' }], '千遥'), 'ちはる');
  assert.equal(
    rubyReadingOf(
      '千遥が',
      [
        { start: 0, end: 1, reading: 'ち' },
        { start: 1, end: 2, reading: 'はる' },
      ],
      '千遥',
    ),
    'ちはる',
  );
  // Only part of the name annotated: no reading rather than half of one.
  assert.equal(rubyReadingOf('千遥が', [{ start: 1, end: 2, reading: 'はる' }], '千遥'), null);
  // A later occurrence can supply what the first lacked.
  assert.equal(
    rubyReadingOf('千遥。千遥', [{ start: 3, end: 5, reading: 'ちはる' }], '千遥'),
    'ちはる',
  );
});
