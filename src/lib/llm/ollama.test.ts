import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCause } from './ollama.ts';

/** What undici throws when a connection never lands: the reason is one level down. */
const fetchFailed = (code: string) => {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = Object.assign(new Error('connect'), {
    code,
  });
  return error;
};

test('names the reason a connection never landed', () => {
  assert.equal(describeCause(fetchFailed('ECONNREFUSED')), '主機拒絕連線');
  assert.equal(describeCause(fetchFailed('ETIMEDOUT')), '連線逾時');
  assert.equal(describeCause(fetchFailed('ENOTFOUND')), '找不到主機');
  assert.equal(describeCause(fetchFailed('EHOSTUNREACH')), '網路無法到達');
});

test('falls back to the code itself rather than swallowing an unknown one', () => {
  assert.equal(describeCause(fetchFailed('ECONNRESET')), 'ECONNRESET');
});

test('uses the cause message when there is no code', () => {
  const error = new TypeError('fetch failed');
  (error as { cause?: unknown }).cause = new Error('TLS 憑證無效');
  assert.equal(describeCause(error), 'TLS 憑證無效');
});

test('falls back to the error itself when there is no cause at all', () => {
  // The message the reader used to get, and the whole reason for this function:
  // on its own it does not say what failed or which host did not answer.
  assert.equal(describeCause(new TypeError('fetch failed')), 'fetch failed');
});

test('survives something that is not an Error', () => {
  assert.equal(describeCause('boom'), 'boom');
  assert.equal(describeCause(null), 'null');
});
