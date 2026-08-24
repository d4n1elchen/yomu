import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildResolverMessages,
  parseResolution,
  RESOLVER_FORMAT,
  type ResolverContext,
} from './resolve-prompt.ts';

const context: ResolverContext = {
  sentence: '夕方になっても、まだ仕事が終わらない。',
  surface: 'なっ',
  candidates: [
    { entryId: '1', headword: '生る', reading: 'なる', glossEn: 'to bear fruit' },
    { entryId: '2', headword: '成る', reading: 'なる', glossEn: 'to become; to get' },
  ],
};

test('tells the model to select from the list, never to name a word', () => {
  const system = buildResolverMessages(context)[0]!;
  assert.equal(system.role, 'system');
  assert.match(system.content, /從清單裡挑選/);
  assert.match(system.content, /不是命名或創造/);
});

test('gives the sentence as context and names the surface in it', () => {
  const user = buildResolverMessages(context)[1]!.content;
  assert.match(user, /句子：夕方になっても/);
  assert.match(user, /句中的「なっ」/);
});

test('lists every candidate id with its headword and gloss', () => {
  const user = buildResolverMessages(context)[1]!.content;
  assert.match(user, /- 1：生る（なる） to bear fruit/);
  assert.match(user, /- 2：成る（なる） to become; to get/);
});

test('refuses to build a prompt with fewer than two candidates', () => {
  assert.throws(
    () => buildResolverMessages({ ...context, candidates: [context.candidates[0]!] }),
    /At least two candidates/,
  );
});

test('the reply schema is a single entry id', () => {
  assert.equal(RESOLVER_FORMAT.type, 'object');
  assert.deepEqual(RESOLVER_FORMAT.required, ['entryId']);
  assert.equal(RESOLVER_FORMAT.properties.entryId.type, 'string');
});

test('accepts a choice that is one of the offered ids', () => {
  assert.equal(parseResolution(JSON.stringify({ entryId: '2' }), ['1', '2']), '2');
});

test('rejects an id the model invented that was never offered', () => {
  assert.equal(parseResolution(JSON.stringify({ entryId: '9' }), ['1', '2']), null);
});

test('rejects malformed or wrong-shaped replies', () => {
  assert.equal(parseResolution('成る', ['1', '2']), null);
  assert.equal(parseResolution(JSON.stringify({ entryId: 2 }), ['1', '2']), null);
  assert.equal(parseResolution(JSON.stringify({ other: '1' }), ['1', '2']), null);
});
