import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildResolverMessages,
  parseResolution,
  RESOLVER_FORMAT,
  type ResolverContext,
} from './resolve-prompt.ts';

const context: ResolverContext = {
  occurrences: [
    { sentence: '夕方になっても、まだ仕事が終わらない。', surface: 'なっ' },
    { sentence: '先生になりたい。', surface: 'なり' },
  ],
  candidates: [
    {
      entryId: '1',
      headword: '生る',
      reading: 'なる',
      glosses: ['to bear fruit'],
      common: false,
    },
    {
      entryId: '2',
      headword: '成る',
      reading: 'なる',
      glosses: ['to become; to get', 'to consist of'],
      common: true,
    },
  ],
};

test('tells the model to select from the list, never to name a word', () => {
  const system = buildResolverMessages(context)[0]!;
  assert.equal(system.role, 'system');
  assert.match(system.content, /從清單裡挑選/);
  assert.match(system.content, /不是命名或創造/);
});

test('asks for a pick even where the word is a helper', () => {
  // Offered a way out, the model unlinked しれる, いう and はず -- helpers whose
  // entries it judged not to be what the sentence meant. There is no way out.
  const system = buildResolverMessages(context)[0]!.content;
  assert.doesNotMatch(system, /none/);
  assert.match(system, /補助用法也要選/);
});

test('gives every occurrence as context and names the surface in each', () => {
  const user = buildResolverMessages(context)[1]!.content;
  assert.match(user, /1\. 夕方になっても.*（「なっ」）/);
  assert.match(user, /2\. 先生になりたい。（「なり」）/);
});

test('lists every candidate id with its headword, commonness and senses', () => {
  const user = buildResolverMessages(context)[1]!.content;
  assert.match(user, /- 1：生る（なる）〔少用〕 to bear fruit/);
  assert.match(user, /- 2：成る（なる）〔常用〕 to become; to get \/ to consist of/);
});

test('refuses to build a prompt with fewer than two candidates or no sentence', () => {
  assert.throws(
    () => buildResolverMessages({ ...context, candidates: [context.candidates[0]!] }),
    /At least two candidates/,
  );
  assert.throws(
    () => buildResolverMessages({ ...context, occurrences: [] }),
    /At least one occurrence/,
  );
});

test('the reply schema is a single entry id', () => {
  assert.equal(RESOLVER_FORMAT.type, 'object');
  assert.deepEqual(RESOLVER_FORMAT.required, ['entryId']);
  assert.equal(RESOLVER_FORMAT.properties.entryId.type, 'string');
});

test('accepts a choice that is one of the offered ids', () => {
  assert.equal(parseResolution(JSON.stringify({ entryId: '2' }), ['1', '2']), '2');
  assert.equal(parseResolution(JSON.stringify({ entryId: 'none' }), ['1', '2']), null);
});

test('rejects an id the model invented that was never offered', () => {
  assert.equal(parseResolution(JSON.stringify({ entryId: '9' }), ['1', '2']), null);
});

test('rejects malformed or wrong-shaped replies', () => {
  assert.equal(parseResolution('成る', ['1', '2']), null);
  assert.equal(parseResolution(JSON.stringify({ entryId: 2 }), ['1', '2']), null);
  assert.equal(parseResolution(JSON.stringify({ other: '1' }), ['1', '2']), null);
});
