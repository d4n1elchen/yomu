import assert from 'node:assert/strict';
import { test } from 'node:test';
import { segmentSentences } from '../text/sentences.ts';
import { kuromojiAnalyzer } from './kuromoji.ts';

const analyze = (text: string) => kuromojiAnalyzer.analyze(text);

function assertPlaced(text: string, tokens: Awaited<ReturnType<typeof analyze>>) {
  let cursor = 0;
  for (const token of tokens) {
    assert.equal(token.charStart, cursor);
    assert.equal(text.slice(token.charStart, token.charEnd), token.surface);
    cursor = token.charEnd;
  }
  assert.equal(cursor, text.length);
}

test('a 2004 print form is analyzed as the word it spells', async () => {
  const text = '電源コードに繫ぐ。';
  const tokens = await analyze(text);
  assertPlaced(text, tokens);
  const verb = tokens.find((t) => t.surface.startsWith('繫'));
  assert.ok(verb);
  // The page keeps the book's glyph; the lemma is the one JMdict knows.
  assert.equal(verb.surface, '繫ぐ');
  assert.equal(verb.lemma, '繋ぐ');
  assert.equal(verb.lemmaReading, 'ツナグ');
  assert.equal(verb.pos, '動詞');
});

test('folding a two-unit kanji keeps every later offset', async () => {
  const text = '𠮟られた。繫がる';
  const tokens = await analyze(text);
  assertPlaced(text, tokens);
  assert.equal(tokens[0]!.surface, '𠮟ら');
  assert.equal(tokens[0]!.lemma, '叱る');
  assert.ok(tokens.some((t) => t.surface === '繫がる' && t.lemma === '繋がる'));
});

test('a run of unknown marks becomes symbols, one per mark', async () => {
  const text = '「すごい!!」と言った。';
  const tokens = await analyze(text);
  assertPlaced(text, tokens);
  const closer = tokens.find((t) => t.surface === '」');
  assert.ok(closer, 'the closing quote is its own token');
  for (const token of tokens.filter((t) => t.surface === '!')) {
    assert.equal(token.pos, '記号');
  }
});

test('〝〟 are symbols, not nouns', async () => {
  const text = '〝補佐〟。次に';
  const tokens = await analyze(text);
  assertPlaced(text, tokens);
  for (const mark of ['〝', '〟']) {
    const token = tokens.find((t) => t.surface === mark);
    assert.ok(token, mark);
    assert.equal(token.pos, '記号');
  }
  assert.ok(tokens.some((t) => t.surface === '。'));
});

test('a quote ending in !! closes, so the next sentence is its own', async () => {
  const text = '「すごい!!」と言った。次の日。';
  const sentences = segmentSentences(text, await analyze(text));
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['「すごい!!」と言った。', '次の日。'],
  );
});
