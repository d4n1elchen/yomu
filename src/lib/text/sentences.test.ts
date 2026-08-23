import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAnalyzer } from '../analyzer/index.ts';
import { segmentSentences } from './sentences.ts';

const analyzer = getAnalyzer();

async function split(text: string): Promise<string[]> {
  const tokens = await analyzer.analyze(text);
  return segmentSentences(text, tokens).map((s) => s.text);
}

test('splits on sentence-final punctuation', async () => {
  assert.deepEqual(await split('本を読む。図書館へ行く。'), [
    '本を読む。',
    '図書館へ行く。',
  ]);
});

test('keeps quoted speech with its reporting clause', async () => {
  // The exclamation mark sits inside the quote, so it must not split here.
  assert.deepEqual(await split('「面白い！」と言った。'), ['「面白い！」と言った。']);
});

test('keeps a full stop inside a quote attached to its sentence', async () => {
  assert.deepEqual(await split('「そうか。」と彼は答えた。'), [
    '「そうか。」と彼は答えた。',
  ]);
});

test('keeps a parenthetical aside inside its sentence', async () => {
  // Asides are almost always mid-sentence, so 。 inside them must not split.
  assert.deepEqual(await split('彼（三十歳）は走った。'), ['彼（三十歳）は走った。']);
});

test('absorbs a trailing closer left over from an unbalanced quote', async () => {
  assert.deepEqual(await split('行くぞ。」次へ。'), ['行くぞ。」', '次へ。']);
});

test('does not split inside an ellipsis', async () => {
  assert.deepEqual(await split('三行目……そして終わり。'), ['三行目……そして終わり。']);
});

test('breaks on newlines and blank lines', async () => {
  assert.deepEqual(await split('一行目です。\n\n二行目だ。'), [
    '一行目です。',
    '二行目だ。',
  ]);
});

test('breaks a line with no terminator at all', async () => {
  assert.deepEqual(await split('見出し\n本文だ。'), ['見出し', '本文だ。']);
});

test('excludes surrounding whitespace from sentence text', async () => {
  const parts = await split('  本を読む。  図書館へ行く。  ');
  assert.deepEqual(parts, ['本を読む。', '図書館へ行く。']);
});

test('recovers from unbalanced quotes at the next newline', async () => {
  // Scraped and transcribed text routinely drops a closing bracket.
  const parts = await split('「行くぞ。まだ続く。\n次の段落だ。');
  assert.equal(parts.length, 2);
  assert.equal(parts[1], '次の段落だ。');
});

test('token offsets are absolute and select their own surface', async () => {
  const text = '昨日、本を三冊借りて読んだ。図書館は静かだ。';
  const tokens = await analyzer.analyze(text);
  for (const sentence of segmentSentences(text, tokens)) {
    for (const token of sentence.tokens) {
      assert.equal(text.slice(token.charStart, token.charEnd), token.surface);
    }
  }
});

test('offsets survive astral characters', async () => {
  // kuromoji reports positions in code points, not UTF-16 units. A single
  // rare kanji or emoji used to slide every later offset by one.
  const text = '𠮷野家で𩸽を食べた。仄暗い水の底から。';
  const tokens = await analyzer.analyze(text);

  for (const token of tokens) {
    assert.equal(
      text.slice(token.charStart, token.charEnd),
      token.surface,
      `absolute offset drifted at ${token.surface}`,
    );
  }

  const parts = segmentSentences(text, tokens);
  assert.deepEqual(
    parts.map((s) => s.text),
    ['𠮷野家で𩸽を食べた。', '仄暗い水の底から。'],
  );

  for (const sentence of parts) {
    for (const token of sentence.tokens) {
      const rebased = sentence.text.slice(
        token.charStart - sentence.charStart,
        token.charEnd - sentence.charStart,
      );
      assert.equal(rebased, token.surface, `rebase drifted at ${token.surface}`);
    }
  }
});
