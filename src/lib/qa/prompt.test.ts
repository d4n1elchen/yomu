import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessages, type PromptToken } from './prompt.ts';

const tokens: PromptToken[] = [
  { surface: '窓', reading: 'マド', lemma: '窓', pos: '名詞' },
  { surface: 'の', reading: 'ノ', lemma: 'の', pos: '助詞' },
  { surface: '外', reading: 'ソト', lemma: '外', pos: '名詞' },
  { surface: '眺め', reading: 'ナガメ', lemma: '眺める', pos: '動詞' },
  { surface: '𩸽', reading: null, lemma: '𩸽', pos: '名詞' },
];

const build = (over: Partial<Parameters<typeof buildMessages>[0]> = {}) =>
  buildMessages({
    sentenceText: '窓の外を眺める',
    tokens,
    question: 'なぜ？',
    ...over,
  });

test('hands the analyzer readings to the model as fact', () => {
  const user = build()[1]!.content;
  // The reading the model must not be left to guess: qwen3.8 rendered
  // 窓の外 as まどのはら when it was not told.
  assert.match(user, /外（そと）/);
  assert.match(user, /窓（まど）/);
});

test('converts readings to hiragana rather than passing katakana through', () => {
  const user = build()[1]!.content;
  assert.equal(user.includes('ソト'), false);
});

test('shows the dictionary form only when it differs from the surface', () => {
  const user = build()[1]!.content;
  assert.match(user, /眺め（ながめ）動詞 ← 眺める/);
  // 窓 is already its own dictionary form, so no arrow.
  assert.equal(/窓（まど）名詞 ←/.test(user), false);
});

test('marks an unknown reading rather than inventing one', () => {
  assert.match(build()[1]!.content, /𩸽（—）/);
});

test('includes the highlighted span when one is given', () => {
  assert.match(build({ selection: '眺め' })[1]!.content, /學生選取的片段：「眺め」/);
  assert.equal(/學生選取的片段/.test(build()[1]!.content), false);
});

test('instructs the model to write Traditional Chinese and not invent readings', () => {
  const system = build()[0]!.content;
  assert.equal(build()[0]!.role, 'system');
  assert.match(system, /繁體中文/);
  assert.match(system, /不要自行推測或改寫任何讀音/);
});

test('carries the question through verbatim', () => {
  assert.match(build({ question: '「と」的作用？' })[1]!.content, /問題：「と」的作用？/);
});
