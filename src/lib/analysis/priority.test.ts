import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import {
  beginInteractive,
  interactiveInFlight,
  resetInteractiveForTests,
  runAbortable,
  yieldToInteractive,
} from './priority.ts';

beforeEach(() => resetInteractiveForTests());

test('nothing in flight by default, and yielding returns at once', async () => {
  assert.equal(interactiveInFlight(), false);
  const started = Date.now();
  await yieldToInteractive();
  assert.ok(Date.now() - started < 50, 'waited when nobody was asking');
});

test('an interactive request marks itself in flight until released', () => {
  const release = beginInteractive();
  assert.equal(interactiveInFlight(), true);
  release();
  assert.equal(interactiveInFlight(), false);
});

test('a waiting drain resumes once the request releases', async () => {
  const release = beginInteractive();
  let resumed = false;
  const waiting = yieldToInteractive().then(() => {
    resumed = true;
  });

  await new Promise((r) => setTimeout(r, 120));
  assert.equal(resumed, false, 'drain proceeded while a reader was waiting');

  release();
  await waiting;
  assert.equal(resumed, true);
});

test('concurrent questions each hold the drain until the last finishes', async () => {
  const first = beginInteractive();
  const second = beginInteractive();

  let resumed = false;
  const waiting = yieldToInteractive().then(() => {
    resumed = true;
  });

  first();
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(resumed, false, 'released too early -- one question still open');

  second();
  await waiting;
  assert.equal(resumed, true);
});

test('releasing twice cannot drive the count below zero', () => {
  // A stream that both returns and throws runs its `finally` once, but the
  // guard matters anyway: a negative count would convince the drain forever
  // that nobody is waiting.
  const release = beginInteractive();
  release();
  release();
  assert.equal(interactiveInFlight(), false);

  beginInteractive();
  assert.equal(interactiveInFlight(), true, 'count went negative');
});

test('a background request is abandoned the moment a question arrives', async () => {
  let abortedAt: number | null = null;
  const started = Date.now();

  const work = runAbortable(
    (signal) =>
      new Promise<string>((resolve, reject) => {
        // Stands in for a long translation: 5s, far longer than the question.
        const timer = setTimeout(() => resolve('finished'), 5000);
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          abortedAt = Date.now() - started;
          reject(new Error('aborted'));
        });
      }),
  );

  await new Promise((r) => setTimeout(r, 50));
  const release = beginInteractive();

  assert.equal(await work, null, 'abandoned work must report null, not a value');
  assert.ok(abortedAt !== null && abortedAt < 500, `abort was late: ${abortedAt}ms`);
  release();
});

test('background work does not start at all while a question is open', async () => {
  const release = beginInteractive();
  let ran = false;
  const result = await runAbortable(async () => {
    ran = true;
    return 'value';
  });
  assert.equal(result, null);
  assert.equal(ran, false, 'started a request with a reader already waiting');
  release();
});

test('a real failure still propagates rather than reading as abandoned', async () => {
  // The distinction the drain depends on: abandoned means retry, thrown means
  // the host is unreachable and the whole pass should stop.
  await assert.rejects(
    () => runAbortable(() => Promise.reject(new Error('ECONNREFUSED'))),
    /ECONNREFUSED/,
  );
});

test('an uninterrupted background request returns its value', async () => {
  const result = await runAbortable(async () => 'translated');
  assert.deepEqual(result, { value: 'translated' });
});
