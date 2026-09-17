import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentSentence } from './progress.ts';

test('above the text the first sentence is where you are', () => {
  assert.equal(currentSentence([100, 130, 160], 72), 0);
});

test('at the bottom of the page the last sentence is where you are', () => {
  // The last screenful never reaches the reading line.
  assert.equal(currentSentence([-900, -300, 200, 500, 700], 72, true), 4);
});

test('at the bottom of a page shorter than a screen, still the last sentence', () => {
  assert.equal(currentSentence([100, 130, 160], 72, true), 2);
});

test('the last sentence to have started above the line is where you are', () => {
  assert.equal(currentSentence([-400, -120, 40, 150], 72), 2);
});

test('a sentence partly scrolled past is still where you are', () => {
  // Started 120px above the line, and the next has not reached it yet.
  assert.equal(currentSentence([-400, -120, 150], 72), 1);
});

test('a sentence starting exactly on the line counts as started', () => {
  // This is the resume position, so it must report the sentence resumed at.
  assert.equal(currentSentence([-80, 72, 72, 130], 72), 2);
});

test('sentences sharing a line resolve to the last to start on it', () => {
  // Resuming puts the later one's first line on the reading line; reporting the
  // earlier one would walk the bookmark backwards on every open.
  assert.equal(currentSentence([10, 60, 60, 60, 110], 72), 3);
});

test('scrolled past everything, the last sentence is where you are', () => {
  assert.equal(currentSentence([-300, -200, -100], 72), 2);
});

test('no sentences, no position', () => {
  assert.equal(currentSentence([], 72), -1);
});
