import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTsutsuji } from './tsutsuji.ts';

/**
 * A cut-down つつじ: the real shape, two meanings of one headword, and the
 * variation that has to collapse into them -- a polite form, a colloquial
 * contraction, and a second spelling.
 */
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<ENTRIES xmlns="http://sslab.nuee.nagoya-u.ac.jp/~matuyosi/simpleXML">
  <L1 L1ID="114" BASE="ながら">
    <L2 L2ID="1" L1to2ID="1141" MCLASS="v21" BASE="ながら" DIFFICULTY="A1" LEFT="dG90" UNCOMMON="0">
      <L3 L3ID="N" L1to3ID="1141N" BASE="ながら">
        <L4 L4ID="1" L1to4ID="1141N.1" BASE="ながら">
          <L5 L5ID="x" L1to5ID="1141N.1x" BASE="ながら">
            <L6 L6ID="x" L1to6ID="1141N.1xx" BASE="ながら">
              <L7 L7ID="03" L1to7ID="1141N.1xx.03" BASE="ながら" RIGHT="6P90">
                <L8 L8ID="n" L1to8ID="1141N.1xx.03n" BASE="ながら">
                  <L9 L9ID="01" ID="1141N.1xx.03n01" PRONUNCIATION="ながら">
ながら
                  </L9>
                  <L9 L9ID="02" ID="1141N.1xx.03n02" PRONUNCIATION="ながら">
乍ら
                  </L9>
                </L8>
              </L7>
            </L6>
          </L5>
        </L4>
      </L3>
    </L2>
    <L2 L2ID="2" L1to2ID="1142" MCLASS="t25" BASE="ながら" DIFFICULTY="B" LEFT="gg90" UNCOMMON="0">
      <L3 L3ID="Q" L1to3ID="1142Q" BASE="ながら">
        <L4 L4ID="1" L1to4ID="1142Q.1" BASE="ながら">
          <L5 L5ID="x" L1to5ID="1142Q.1x" BASE="ながら">
            <L6 L6ID="x" L1to6ID="1142Q.1xx" BASE="ながら">
              <L7 L7ID="03" L1to7ID="1142Q.1xx.03" BASE="ながら" RIGHT="6Q90">
                <L8 L8ID="n" L1to8ID="1142Q.1xx.03n" BASE="ながら">
                  <L9 L9ID="01" ID="1142Q.1xx.03n01" PRONUNCIATION="ながら">
ながら
                  </L9>
                </L8>
              </L7>
            </L6>
          </L5>
        </L4>
      </L3>
    </L2>
  </L1>
  <L1 L1ID="001" BASE="に.とっ.て">
    <L2 L2ID="1" L1to2ID="0011" MCLASS="a21" BASE="に.とっ.て" DIFFICULTY="A2" LEFT="1090" STYLE="normal">
      <L3 L3ID="P" L1to3ID="0011P" BASE="に.とっ.て">
        <L4 L4ID="1" L1to4ID="0011P.1" BASE="に.とっ.て">
          <L5 L5ID="x" L1to5ID="0011P.1x" BASE="に.とっ.て">
            <L6 L6ID="x" L1to6ID="0011P.1xx" BASE="に.とっ.て">
              <L7 L7ID="01" L1to7ID="0011P.1xx.01" BASE="に.とっ.て" TAIL="て" RIGHT="6H90">
                <L8 L8ID="n" L1to8ID="0011P.1xx.01n" BASE="に.とっ.て" CORE="2/3">
                  <L9 L9ID="01" ID="0011P.1xx.01n01" PRONUNCIATION="に.とっ.て">
に.とっ.て
                  </L9>
                </L8>
                <L8 L8ID="s" L1to8ID="0011P.1xx.01s" BASE="に.とり.まし.て" STYLE="polite">
                  <L9 L9ID="01" ID="0011P.1xx.01s01" PRONUNCIATION="に.とり.まし.て">
に.とり.まし.て
                  </L9>
                </L8>
              </L7>
            </L6>
          </L5>
          <L5 L5ID="h" L1to5ID="0011P.1h" BASE="に.とっ.ちゃ" STYLE="colloquial">
            <L6 L6ID="x" L1to6ID="0011P.1hx" BASE="に.とっ.ちゃ">
              <L7 L7ID="34" L1to7ID="0011P.1hx.34" BASE="に.とっ.ちゃ" RIGHT="6Q90">
                <L8 L8ID="n" L1to8ID="0011P.1hx.34n" BASE="に.とっ.ちゃ">
                  <L9 L9ID="01" ID="0011P.1hx.34n01" PRONUNCIATION="に.とっ.ちゃ">
に.とっ.ちゃ
                  </L9>
                </L8>
              </L7>
            </L6>
          </L5>
        </L4>
      </L3>
    </L2>
  </L1>
</ENTRIES>`;

const CONNECT_ID = `10\t名詞,*,*,*,*,*,*
6H\t助詞,接続助詞,*,*,*,*,て;助詞,接続助詞,*,*,*,*,で
b9\t10;2h
`;

const CLASS_NAME = `v21\t付帯-並行-ナガラ類
t25\t逆接-確定-ケレドモ類
a21\t立場-状態-ニトッテ類
`;

const parsed = parseTsutsuji({
  xml: XML,
  connectID: CONNECT_ID,
  className: CLASS_NAME,
});

test('one headword with two meanings becomes two entries', () => {
  // ながら "while" and ながら "although" are the same word and different
  // points. Merging them at L1 would file both under one card.
  assert.deepEqual(
    parsed.entries.map((e) => [e.id, e.base, e.difficulty, e.meaningClass]),
    [
      ['1141', 'ながら', 'A1', 'v21'],
      ['1142', 'ながら', 'B', 't25'],
      ['0011', 'にとって', 'A2', 'a21'],
    ],
  );
});

test('every written form files under its meaning, not its own id', () => {
  // 乍ら, にとりまして and にとっちゃ are spelling, politeness and contraction:
  // つつじ's levels 5, 8 and 9, all below the meaning.
  const forms = (id: string) =>
    parsed.patterns.filter((p) => p.entryId === id).map((p) => p.units.join(''));

  assert.deepEqual(forms('1141'), ['ながら', '乍ら']);
  assert.deepEqual(forms('0011'), ['にとって', 'にとりまして', 'にとっちゃ']);
});

test('a form keeps the units the analyzer would produce', () => {
  const pattern = parsed.patterns.find((p) => p.units.join('') === 'にとって');
  assert.deepEqual(pattern?.units, ['に', 'とっ', 'て']);
});

test('connection codes are inherited from where they are written', () => {
  // LEFT is written on L2 and RIGHT on L7, so a form must collect both on its
  // way down. Getting this wrong would leave every form unconstrained.
  const pattern = parsed.patterns.find((p) => p.units.join('') === 'にとって');
  assert.equal(pattern?.left, '1090');
  assert.equal(pattern?.right, '6H90');
});

test('a lower level overrides what it inherits', () => {
  const colloquial = parsed.patterns.find((p) => p.units.join('') === 'にとっちゃ');
  assert.equal(colloquial?.right, '6Q90');
});

test('connection classes keep their alternatives, references included', () => {
  assert.deepEqual(parsed.connections['6H'], [
    '助詞,接続助詞,*,*,*,*,て',
    '助詞,接続助詞,*,*,*,*,で',
  ]);
  assert.deepEqual(parsed.connections['b9'], ['10', '2h']);
});

test('meaning classes carry their Japanese names', () => {
  assert.equal(parsed.meaningNames['t25'], '逆接-確定-ケレドモ類');
});
