import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_LEVEL, MAX_BAND } from '../marking.ts';
import { parseLevel } from './level.ts';

test('reads back a stored band', () => {
  assert.equal(parseLevel('1'), 1);
  assert.equal(parseLevel('33'), 33);
  assert.equal(parseLevel(String(MAX_BAND)), MAX_BAND);
});

test('falls back to the default when nothing has been stored', () => {
  assert.equal(parseLevel(null), DEFAULT_LEVEL);
});

test('falls back to the default for anything that is not a band', () => {
  for (const raw of ['', '0', '49', '-3', '12.5', 'abc', 'NaN']) {
    assert.equal(parseLevel(raw), DEFAULT_LEVEL, raw);
  }
});
