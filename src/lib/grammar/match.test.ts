import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAnalyzer } from '../analyzer/index.ts';
import { compileInventory, type GrammarInventory } from './inventory.ts';
import { matchSentence } from './match.ts';

const analyzer = getAnalyzer();

/**
 * A hand-cut corner of つつじ: real ids, real forms, real connection codes,
 * small enough to read. The full inventory is 16,801 forms in the gitignored
 * `data/`, which a test must not need.
 */
const INVENTORY: GrammarInventory = {
  entries: [
    { id: '1351', base: 'ている', difficulty: 'A1', meaningClass: 'J3' },
    { id: '0623', base: 'ては', difficulty: 'A2', meaningClass: 'r3' },
    { id: '1751', base: 'ことができる', difficulty: 'A2', meaningClass: 'E1' },
    { id: '1593', base: 'こと', difficulty: 'A1', meaningClass: 'S1' },
    { id: '0731', base: 'ために', difficulty: 'A2', meaningClass: 's2' },
    { id: '0732', base: 'ために', difficulty: 'A2', meaningClass: 'N1' },
    { id: '1871', base: 'ようにする', difficulty: 'A2', meaningClass: 'G2' },
    { id: '0251', base: 'にして', difficulty: 'F', meaningClass: 'd1' },
  ],
  patterns: [
    // ～ている, the ～てい a following た leaves behind, and both again voiced
    // after a stem like 読ん. All one entry: spelling, voicing and conjugation
    // are つつじ's lower levels, below the meaning a card is filed under.
    { entryId: '1351', units: ['て', 'いる'], left: 'd890', right: '2A90' },
    { entryId: '1351', units: ['て', 'い'], left: 'd890', right: '2G90' },
    { entryId: '1351', units: ['で', 'いる'], left: 'd990', right: '2A90' },
    { entryId: '1351', units: ['で', 'い'], left: 'd990', right: '2G90' },
    // ～ては. Its left class is the same 連用形/連用タ接続 verb: this is what
    // keeps it off 感じ**では**なかった.
    { entryId: '0623', units: ['て', 'は'], left: 'd890', right: '6T90' },
    { entryId: '0623', units: ['で', 'は'], left: 'd990', right: '6T90' },
    { entryId: '1751', units: ['こと', 'が', 'できる'], left: 'b190', right: '2A90' },
    { entryId: '1593', units: ['こと'], left: 'b390', right: '1090' },
    { entryId: '0731', units: ['ため', 'に'], left: 'b690', right: '6P90' },
    { entryId: '0732', units: ['ため', 'に'], left: 'b690', right: '6P90' },
    { entryId: '1871', units: ['よう', 'に', 'し'], left: 'd190', right: '2g90' },
    { entryId: '0251', units: ['に', 'し', 'て'], left: '1090', right: '6H90' },
  ],
  connections: {
    // Verb stems a て-form attaches to, and the ordinary-noun class.
    '2g': ['動詞,*,*,*,*,連用形,*'],
    '2H': ['動詞,*,*,*,*,連用タ接続,*'],
    d8: ['2g', '2H'],
    d9: ['動詞,*,*,*,五段・ガ行,連用タ接続,*', '動詞,*,*,*,五段・マ行,連用タ接続,*'],
    '10': ['名詞,*,*,*,*,*,*'],
    '2A': ['動詞,*,*,*,*,基本形,*'],
    '2G': ['動詞,*,*,*,*,連用形,*'],
    '6H': ['助詞,接続助詞,*,*,*,*,て'],
    '6P': ['助詞,格助詞,一般,*,*,*,に'],
    '6T': ['助詞,係助詞,*,*,*,*,は'],
    b1: ['動詞,*,*,*,*,基本形,*', '名詞,*,*,*,*,*,*'],
    b3: ['動詞,*,*,*,*,基本形,*'],
    b6: ['動詞,*,*,*,*,基本形,*', '名詞,*,*,*,*,*,*', '助動詞,*,*,*,*,体言接続,*'],
    d1: ['動詞,*,*,*,*,基本形,*', '助動詞,*,*,*,*,基本形,*'],
  },
};

const inventory = compileInventory(INVENTORY);

async function match(text: string) {
  const tokens = await analyzer.analyze(text);
  return matchSentence(tokens, inventory).map((m) => ({
    surface: m.surface,
    ids: m.entryIds,
    text: text.slice(m.charStart, m.charEnd),
  }));
}

test('finds a form and reports where it is in the sentence', async () => {
  assert.deepEqual(await match('本を読んでいる。'), [
    { surface: 'でいる', ids: ['1351'], text: 'でいる' },
  ]);
});

test('finds the same entry through a conjugated form', async () => {
  // ～ていた leaves only ～てい before the た, and it is still ～ている: the
  // conjugation sits below the meaning in つつじ's tree, so both forms carry
  // the one id a card would be filed under.
  const [hit] = await match('本を読んでいた。');
  assert.equal(hit?.ids.join(), '1351');
  assert.equal(hit?.text, 'でい');
});

test('a connection constraint keeps a form off a look-alike', async () => {
  // で is the copula here, not a て-form: the token before it is a noun, and
  // ～ては requires a verb stem. This exact sentence was a false positive
  // before the constraint was checked.
  assert.deepEqual(await match('嫌な感じではなかった。'), []);
});

test('the same constraint still admits the real thing', async () => {
  const hits = await match('本を読んでは、また閉じた。');
  assert.equal(hits[0]?.ids.join(), '0623');
  assert.equal(hits[0]?.text, 'では');
});

test('keeps the longest form and drops what it swallows', async () => {
  // ～こと is inside ～ことができる. Offering both would be two cards claiming
  // the same characters.
  const hits = await match('泳ぐことができる。');
  assert.deepEqual(
    hits.map((h) => h.ids.join()),
    ['1751'],
  );
});

test('two meanings of one form are one match with two candidates', async () => {
  // ために "because" and ために "in order to" are written identically; which
  // one this is is the model's question, and both must reach it.
  const [hit] = await match('勝つために練習する。');
  assert.deepEqual(hit?.ids, ['0731', '0732']);
});

test('overlapping forms of equal length: the earlier one wins', async () => {
  // よう.に.し and に.し.て overlap in ようにしている without either containing
  // the other, and are the same length. The sentence is doing ～ようにする; the
  // ～にして is an accident of where it starts, and drops out. ～ている survives
  // because it begins after ようにし ends -- two points, not one overlap.
  const hits = await match('目立たないようにしている。');
  assert.deepEqual(
    hits.map((h) => h.ids.join()),
    ['1871', '1351'],
  );
});

test('a form needing something to its left cannot open a sentence', async () => {
  assert.deepEqual(await match('ことができる。'), []);
});

test('says nothing about a sentence with no grammar in the inventory', async () => {
  assert.deepEqual(await match('猫が好きだ。'), []);
});

test('two forms may share the joint they are chained on', async () => {
  // ～ようにしている is ～ようにする in て-form followed by ～ている, and the て
  // belongs to both. Greedy alone kept よう.に.し.て and left ている with
  // nowhere to begin, which lost the commonest point in the language.
  const hits = await match('目立たないようにしていた。');
  assert.deepEqual(
    hits.map((h) => h.ids.join()),
    ['1871', '1351'],
  );
});

test('sharing a joint is not licence to overlap further', async () => {
  // ～こと inside ～ことができる starts where nothing ends, and is contained
  // rather than chained: it stays dropped.
  const hits = await match('泳ぐことができる。');
  assert.deepEqual(
    hits.map((h) => h.ids.join()),
    ['1751'],
  );
});
