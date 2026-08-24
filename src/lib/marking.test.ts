import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_LEVEL, MAX_BAND, isHardWord, type Markable } from './marking.ts';

/** A ranked word: the corpus placed it, so the band decides on its own. */
const ranked = (band: number): Markable => ({
  contentWord: true,
  band,
  common: true,
});

test('marks a word rarer than the level, leaves a commoner one alone', () => {
  assert.equal(isHardWord(ranked(30), 20), true);
  assert.equal(isHardWord(ranked(5), 20), false);
});

test('the level itself counts as known', () => {
  assert.equal(isHardWord(ranked(20), 20), false);
  assert.equal(isHardWord(ranked(21), 20), true);
});

test('the top band is marked only at the very lowest level', () => {
  assert.equal(isHardWord(ranked(1), 1), false);
  assert.equal(isHardWord(ranked(2), 1), true);
});

test('a ranked word is judged on its rank, common flag or not', () => {
  // The flag is one bit and says yes to most vocabulary. Where there is a real
  // ranking it has nothing to add.
  assert.equal(isHardWord({ contentWord: true, band: 40, common: true }, 20), true);
  assert.equal(isHardWord({ contentWord: true, band: 3, common: false }, 20), false);
});

test('an unranked word JMdict calls common is not marked', () => {
  // 本 carries `ichi1` and no `nf` at all -- the newspaper corpus never ranked
  // it. Reading that null as "rarer than the 24,000th" would put a dashed
  // underline under the word for "book".
  const book: Markable = { contentWord: true, band: null, common: true };
  assert.equal(isHardWord(book, DEFAULT_LEVEL), false);
  assert.equal(isHardWord(book, 1), false);
});

test('an unranked word nothing vouches for is marked at any level', () => {
  // Either genuinely rarer than the top 24,000, or it matched no entry at all.
  // Both are the reader meeting a word no dictionary calls ordinary.
  const obscure: Markable = { contentWord: true, band: null, common: false };
  assert.equal(isHardWord(obscure, MAX_BAND), true);
  assert.equal(isHardWord(obscure, 1), true);
});

test('function words and punctuation are never marked', () => {
  // Whether a token is a content word is decided by `contentWord` in SQL; a
  // dashed underline under を would be noise rather than a difficulty signal.
  assert.equal(
    isHardWord({ contentWord: false, band: null, common: false }, DEFAULT_LEVEL),
    false,
  );
  assert.equal(
    isHardWord({ contentWord: false, band: MAX_BAND, common: false }, 1),
    false,
  );
});
