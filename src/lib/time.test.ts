import assert from 'node:assert/strict';
import { test } from 'node:test';
import { relativeTime } from './time.ts';

const NOW = 1_800_000_000;
const at = (agoSeconds: number) => relativeTime(NOW - agoSeconds, NOW);

test('says so plainly when an article has never been opened', () => {
  assert.equal(relativeTime(null, NOW), '尚未閱讀');
});

test('counts up through minutes, hours and days', () => {
  assert.equal(at(5), '剛剛');
  assert.equal(at(59), '剛剛');
  assert.equal(at(60), '1 分鐘前');
  assert.equal(at(45 * 60), '45 分鐘前');
  assert.equal(at(2 * 3600), '2 小時前');
  assert.equal(at(23 * 3600), '23 小時前');
  assert.equal(at(25 * 3600), '昨天');
  assert.equal(at(3 * 86400), '3 天前');
});

test('falls back to a date once the relative form stops informing', () => {
  assert.match(at(30 * 86400), /^\d{4}\/\d{2}\/\d{2}$/);
});

test('a clock that has drifted backwards reads as just now, never negative', () => {
  assert.equal(relativeTime(NOW + 120, NOW), '剛剛');
});
