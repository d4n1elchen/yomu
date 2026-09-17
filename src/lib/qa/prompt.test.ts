import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessages, type PromptInput, type PromptToken } from './prompt.ts';

const tokens: PromptToken[] = [
  { surface: '窓', reading: 'マド', lemma: '窓', pos: '名詞' },
  { surface: 'の', reading: 'ノ', lemma: 'の', pos: '助詞' },
  { surface: '外', reading: 'ソト', lemma: '外', pos: '名詞' },
  { surface: '眺め', reading: 'ナガメ', lemma: '眺める', pos: '動詞' },
  { surface: '𩸽', reading: null, lemma: '𩸽', pos: '名詞' },
];

const build = (over: Partial<PromptInput> = {}) =>
  buildMessages({
    target: { text: '窓の外を眺める。', tokens },
    previous: '雨が降っていた。',
    next: 'それから本を読んだ。',
    turns: [{ role: 'user', content: 'なぜ？' }],
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
  assert.equal(build()[1]!.content.includes('ソト'), false);
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

test('labels the target and places the neighbours either side of it', () => {
  const user = build()[1]!.content;
  const previous = user.indexOf('【前一句】（僅供脈絡）\n雨が降っていた。');
  const target = user.indexOf('【目標句】（學生問的是這一句）\n窓の外を眺める。');
  const next = user.indexOf('【後一句】（僅供脈絡）\nそれから本を読んだ。');

  assert.ok(previous >= 0 && target >= 0 && next >= 0);
  assert.ok(previous < target && target < next);
});

test('only the target sentence gets a token table', () => {
  const user = build()[1]!.content;
  assert.equal(user.match(/詞法分析結果/g)!.length, 1);
  assert.match(user, /【目標句】的詞法分析結果/);
});

test('tells the model the neighbours are context, not the question', () => {
  const system = build()[0]!.content;
  assert.match(system, /學生問的是【目標句】/);
  assert.match(system, /不要解釋它們/);
});

test('leaves out a neighbour at the edge of a chapter', () => {
  const user = build({ previous: null, next: null })[1]!.content;
  assert.equal(user.includes('【前一句】'), false);
  assert.equal(user.includes('【後一句】'), false);
  assert.match(user, /^【目標句】/);
});

test('instructs the model to write Traditional Chinese and not invent readings', () => {
  const system = build()[0]!.content;
  assert.equal(build()[0]!.role, 'system');
  assert.match(system, /繁體中文/);
  assert.match(system, /不要自行推測或改寫任何讀音/);
});

test('carries the question through verbatim, tied to the target', () => {
  const turns = [{ role: 'user' as const, content: '「と」的作用？' }];
  assert.match(
    build({ turns })[1]!.content,
    /關於【目標句】的問題：「と」的作用？$/,
  );
});

test('later turns follow the context as an ordinary conversation', () => {
  const messages = build({
    turns: [
      { role: 'user', content: '說明文法' },
      { role: 'assistant', content: '〜つもりだ 表示打算。' },
      { role: 'user', content: '語感差異？' },
    ],
  });

  assert.deepEqual(
    messages.map((m) => m.role),
    ['system', 'user', 'assistant', 'user'],
  );
  assert.equal(messages[2]!.content, '〜つもりだ 表示打算。');
  assert.equal(messages[3]!.content, '語感差異？');
});

test('the sentences are sent once, not once per turn', () => {
  const messages = build({
    turns: [
      { role: 'user', content: '說明文法' },
      { role: 'assistant', content: '…' },
      { role: 'user', content: '再說明' },
    ],
  });
  const withTables = messages.filter((m) => m.content.includes('詞法分析結果'));
  assert.equal(withTables.length, 1);
  assert.equal(messages.at(-1)!.content, '再說明');
});

test('refuses to build a prompt with no question', () => {
  assert.throws(() => build({ turns: [] }), /question is required/);
});
