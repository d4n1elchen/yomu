import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildTranslationMessages,
  parseTranslation,
  TRANSLATION_FORMAT,
  type TranslationEntry,
} from './prompt.ts';

const entry: TranslationEntry = {
  headword: '成る',
  reading: 'なる',
  senses: [
    { pos: 'v5r,vi', glossEn: 'to become; to get; to grow' },
    { pos: 'v5r,vi', glossEn: 'to result in; to turn out' },
  ],
};

test('instructs the model to write Traditional Chinese, never Simplified', () => {
  const system = buildTranslationMessages(entry)[0]!;
  assert.equal(system.role, 'system');
  assert.match(system.content, /繁體中文/);
  assert.match(system.content, /簡體/);
});

test('tells the model it is translating, not defining', () => {
  const system = buildTranslationMessages(entry)[0]!.content;
  assert.match(system, /翻譯/);
  assert.match(system, /不是重新定義/);
});

test('lists every English sense in order for the model to render', () => {
  const user = buildTranslationMessages(entry)[1]!.content;
  assert.match(user, /1\. （v5r,vi）to become; to get; to grow/);
  assert.match(user, /2\. （v5r,vi）to result in; to turn out/);
  // The count is stated so a dropped sense is a visible contract, not a surprise.
  assert.match(user, /共 2 條/);
});

test('hands over the headword and reading as grounding, never asks for them', () => {
  const user = buildTranslationMessages(entry)[1]!.content;
  assert.match(user, /詞條：成る（なる）/);
});

test('refuses to build a prompt for an entry with no senses', () => {
  assert.throws(
    () => buildTranslationMessages({ headword: '本', reading: 'ほん', senses: [] }),
    /at least one sense/,
  );
});

test('the reply schema is a flat array of sense strings', () => {
  assert.equal(TRANSLATION_FORMAT.type, 'object');
  assert.deepEqual(TRANSLATION_FORMAT.required, ['senses']);
  assert.equal(TRANSLATION_FORMAT.properties.senses.type, 'array');
});

test('accepts a well-formed reply with the right count', () => {
  const raw = JSON.stringify({ senses: ['成為；變成', '結果變成'] });
  assert.deepEqual(parseTranslation(raw, 2), ['成為；變成', '結果變成']);
});

test('trims surrounding whitespace from each gloss', () => {
  const raw = JSON.stringify({ senses: ['  成為  ', '結果'] });
  assert.deepEqual(parseTranslation(raw, 2), ['成為', '結果']);
});

test('rejects a reply whose sense count does not match what was sent', () => {
  assert.equal(parseTranslation(JSON.stringify({ senses: ['只有一條'] }), 2), null);
  assert.equal(
    parseTranslation(JSON.stringify({ senses: ['一', '二', '三'] }), 2),
    null,
  );
});

test('rejects an empty or non-string gloss rather than writing it', () => {
  assert.equal(parseTranslation(JSON.stringify({ senses: ['成為', ''] }), 2), null);
  assert.equal(parseTranslation(JSON.stringify({ senses: ['成為', 3] }), 2), null);
});

test('rejects prose that is not JSON at all', () => {
  assert.equal(parseTranslation('這個詞的意思是成為。', 1), null);
  assert.equal(parseTranslation(JSON.stringify({ other: ['x'] }), 1), null);
});
