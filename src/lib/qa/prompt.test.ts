import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildMessages, type PromptSentence, type PromptToken } from './prompt.ts';

const tokens: PromptToken[] = [
  { surface: '窓', reading: 'マド', lemma: '窓', pos: '名詞' },
  { surface: 'の', reading: 'ノ', lemma: 'の', pos: '助詞' },
  { surface: '外', reading: 'ソト', lemma: '外', pos: '名詞' },
  { surface: '眺め', reading: 'ナガメ', lemma: '眺める', pos: '動詞' },
  { surface: '𩸽', reading: null, lemma: '𩸽', pos: '名詞' },
];

const sentence: PromptSentence = {
  text: '窓の外を眺める',
  tokens,
  selected: '眺め',
};

const build = (over: Partial<Parameters<typeof buildMessages>[0]> = {}) =>
  buildMessages({
    sentences: [sentence],
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

test('always names the selected fragment', () => {
  assert.match(build()[1]!.content, /學生選取的片段：「眺め」/);
});

test('instructs the model to write Traditional Chinese and not invent readings', () => {
  const system = build()[0]!.content;
  assert.equal(build()[0]!.role, 'system');
  assert.match(system, /繁體中文/);
  assert.match(system, /不要自行推測或改寫任何讀音/);
});

test('carries the question through verbatim', () => {
  const turns = [{ role: 'user' as const, content: '「と」的作用？' }];
  assert.match(build({ turns })[1]!.content, /問題：「と」的作用？/);
});

test('a selection spanning sentences carries every sentence and its tokens', () => {
  const second: PromptSentence = {
    text: '本を読んだ。',
    tokens: [{ surface: '読ん', reading: 'ヨン', lemma: '読む', pos: '動詞' }],
    selected: '読ん',
  };
  const user = build({ sentences: [sentence, second] })[1]!.content;

  assert.match(user, /句子 1：/);
  assert.match(user, /句子 2：/);
  assert.match(user, /読ん（よん）動詞 ← 読む/);
  // The fragment is the concatenation of what was selected in each sentence.
  assert.match(user, /學生選取的片段：「眺め読ん」/);
});

test('a single sentence is not numbered', () => {
  const user = build()[1]!.content;
  assert.match(user, /句子：/);
  assert.equal(/句子 1：/.test(user), false);
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

test('the token tables are sent once, not once per turn', () => {
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

test('refuses to build a prompt with no question or no selection', () => {
  assert.throws(() => build({ turns: [] }), /question is required/);
  assert.throws(() => build({ sentences: [] }), /selection is required/);
});
