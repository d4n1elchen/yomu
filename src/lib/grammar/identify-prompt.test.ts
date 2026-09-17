import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildIdentifyMessages,
  parseIdentification,
  type PromptSpan,
} from './identify-prompt.ts';

const SPANS: PromptSpan[] = [
  {
    n: 1,
    surface: 'ために',
    before: '勝つ',
    after: '練習する',
    candidates: [
      { pointId: '0731', name: '～ために（因為…）', gloss: '表示導致某結果的原因。' },
      { pointId: '0732', name: '～ために（為了…）', gloss: '表示行動的目的。' },
    ],
  },
  {
    n: 2,
    surface: 'ている',
    before: '練習し',
    after: '。',
    candidates: [
      { pointId: '1351', name: '～ている（正在…）', gloss: '動作進行或狀態持續。' },
    ],
  },
];

test('the sentence and every span go in one request', () => {
  const [system, user] = buildIdentifyMessages({
    sentence: '勝つために練習している。',
    spans: SPANS,
  });

  assert.equal(system?.role, 'system');
  assert.match(user!.content, /勝つために練習している。/u);
  // Both spans in one message: judging them together is what lifted recall
  // from 79% to 91%, so a prompt that splits them is the wrong prompt.
  assert.match(user!.content, /片段 1：勝つ【ために】練習する/u);
  assert.match(user!.content, /片段 2：練習し【ている】。/u);
  assert.match(user!.content, /0731：～ために（因為…）/u);
  assert.match(user!.content, /1351：～ている（正在…）/u);
});

test('the model is told it is choosing, not naming', () => {
  const [system] = buildIdentifyMessages({ sentence: 'あ', spans: SPANS });
  assert.match(system!.content, /從清單裡挑選/u);
  assert.match(system!.content, /none/u);
});

test('refuses to ask about nothing', () => {
  assert.throws(() => buildIdentifyMessages({ sentence: 'あ', spans: [] }));
});

test('keeps the choices that were actually offered', () => {
  const reply = JSON.stringify({
    spans: [
      { n: 1, id: '0732' },
      { n: 2, id: '1351' },
    ],
    others: [],
  });
  const parsed = parseIdentification(reply, SPANS);
  assert.deepEqual([...parsed!.picks], [
    [1, '0732'],
    [2, '1351'],
  ]);
});

test('drops an id that belongs to another span', () => {
  // 1351 is span 2's candidate. Accepting it for span 1 would file ～ている
  // over the characters ために -- a card pointing at the wrong words.
  const reply = JSON.stringify({ spans: [{ n: 1, id: '1351' }], others: [] });
  assert.equal(parseIdentification(reply, SPANS)!.picks.size, 0);
});

test('drops an id nobody offered, and a span nobody asked about', () => {
  const reply = JSON.stringify({
    spans: [
      { n: 1, id: '9999' },
      { n: 7, id: '0731' },
    ],
    others: [],
  });
  assert.equal(parseIdentification(reply, SPANS)!.picks.size, 0);
});

test('"none" is not a choice, it is the absence of one', () => {
  const reply = JSON.stringify({ spans: [{ n: 1, id: 'none' }], others: [] });
  assert.equal(parseIdentification(reply, SPANS)!.picks.size, 0);
});

test('keeps off-list proposals, which are explained but never addable', () => {
  const reply = JSON.stringify({
    spans: [],
    others: [{ form: '練習している', name: '～ている（狀態）' }, { form: ' ', name: 'x' }],
  });
  assert.deepEqual(parseIdentification(reply, SPANS)!.others, [
    { form: '練習している', name: '～ている（狀態）' },
  ]);
});

test('malformed JSON is no cards rather than wrong cards', () => {
  assert.equal(parseIdentification('{"spans": [', SPANS), null);
  assert.equal(parseIdentification('"nope"', SPANS), null);
});
