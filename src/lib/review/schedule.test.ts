import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  grade,
  INTERVAL_DAYS,
  isDue,
  RETRY_SECONDS,
  TOP_BOX,
  type ScheduleState,
} from './schedule.ts';

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;
const fresh: ScheduleState = { familiarity: 0, lastReviewedAt: null, srsDue: null };

test('a kept item is due at once', () => {
  assert.equal(isDue(fresh, NOW), true);
});

test('a right answer moves it up a box and out a day', () => {
  const next = grade(fresh, true, NOW);
  assert.equal(next.familiarity, 1);
  assert.equal(next.srsDue, NOW + DAY);
  assert.equal(isDue(next, NOW), false);
  assert.equal(isDue(next, NOW + DAY), true);
});

test('each right answer pushes it further out', () => {
  let state: ScheduleState = { ...fresh };
  const due: number[] = [];
  for (let i = 0; i < 4; i++) {
    state = grade(state, true, NOW);
    due.push((state.srsDue! - NOW) / DAY);
  }
  assert.deepEqual(due, [1, 3, 7, 16]);
});

test('the top box holds rather than overflowing', () => {
  let state: ScheduleState = { ...fresh };
  for (let i = 0; i < TOP_BOX + 3; i++) state = grade(state, true, NOW);
  assert.equal(state.familiarity, TOP_BOX);
  assert.equal(state.srsDue, NOW + INTERVAL_DAYS[TOP_BOX] * DAY);
});

test('a miss goes back to the start and returns within the sitting', () => {
  const known = { familiarity: 4, lastReviewedAt: NOW - DAY, srsDue: NOW };
  const next = grade(known, false, NOW);
  assert.equal(next.familiarity, 0);
  assert.equal(next.srsDue, NOW + RETRY_SECONDS);
  assert.equal(next.lastReviewedAt, NOW);
});
