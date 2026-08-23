import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectionSpans, type TouchedToken } from './selection.ts';

const token = (
  sentenceId: string,
  charStart: number,
  charEnd: number,
): TouchedToken => ({ sentenceId, charStart, charEnd });

test('snaps a part-word drag out to whole tokens', () => {
  // Dragging across 読み終わ touches 読み and 終わる; the question is about
  // 読み終わる, not about the characters the pointer happened to stop on.
  assert.deepEqual(selectionSpans([token('s1', 8, 10), token('s1', 10, 13)]), [
    { sentenceId: 's1', charStart: 8, charEnd: 13 },
  ]);
});

test('keeps one span per sentence when a selection crosses a boundary', () => {
  const spans = selectionSpans([
    token('s1', 12, 14),
    token('s1', 14, 15),
    token('s2', 0, 2),
  ]);
  assert.deepEqual(spans, [
    { sentenceId: 's1', charStart: 12, charEnd: 15 },
    { sentenceId: 's2', charStart: 0, charEnd: 2 },
  ]);
});

test('orders spans by where each sentence was first touched', () => {
  const spans = selectionSpans([token('s2', 0, 2), token('s1', 5, 7)]);
  assert.deepEqual(
    spans.map((s) => s.sentenceId),
    ['s2', 's1'],
  );
});

test('a token revisited out of order still widens its sentence span', () => {
  const spans = selectionSpans([
    token('s1', 5, 7),
    token('s2', 0, 1),
    token('s1', 0, 2),
  ]);
  assert.deepEqual(spans[0], { sentenceId: 's1', charStart: 0, charEnd: 7 });
});

test('touching nothing yields nothing, rather than an empty span', () => {
  assert.deepEqual(selectionSpans([]), []);
});
