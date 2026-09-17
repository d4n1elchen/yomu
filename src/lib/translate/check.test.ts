import assert from 'node:assert/strict';
import { test } from 'node:test';
import { glossProblem, stripAddedLabel } from './check.ts';

test('Simplified characters are refused, naming the character', () => {
  assert.match(glossProblem('各种各样', 'various') ?? '', /簡體字「种」/);
  assert.match(glossProblem('不會吧！；难以置信！', 'no way!') ?? '', /「难」/);
});

test('Japanese shinjitai are refused as well', () => {
  assert.match(glossProblem('空気', 'air') ?? '', /日文字形「気」/);
});

test('characters Taiwan also writes are not refused', () => {
  assert.equal(glossProblem('拮据；經濟困難', 'to be hard up'), null);
  assert.equal(glossProblem('溫暖；况且', 'warm'), null);
  assert.equal(glossProblem('鎮定；從容', 'composure'), null);
});

test('mainland vocabulary is refused with the Taiwan word', () => {
  assert.match(glossProblem('要求視頻回放', 'video review') ?? '', /台灣說「影片」/);
});

test('English left behind is refused; capitals and transliterations are not', () => {
  assert.match(glossProblem('過早； premature', 'premature') ?? '', /「premature」/);
  assert.match(glossProblem('稍微；-ish', 'somewhat; -ish') ?? '', /「ish」/);
  assert.match(glossProblem('大力搬運（如 portable shrine）', 'to carry (e.g. a portable shrine)') ?? '', /portable/);
  assert.equal(glossProblem('逃逸；ESC', 'escape; ESC'), null);
  assert.equal(glossProblem('載入（資料）；擷取（如 CPU 指令）', 'to fetch (e.g. a CPU instruction)'), null);
  assert.equal(
    glossProblem('mano-vijnana（心識）', 'mano-vijnana (mental consciousness)'),
    null,
  );
  assert.equal(
    glossProblem('貓（特指家貓，學名 Felis catus）', 'cat (esp. the domestic cat, Felis catus)'),
    null,
  );
  assert.equal(glossProblem('便利貼；Post-it 便利貼', 'sticky note; Post-it note'), null);
  // Capitalised in the Chinese, lowercase in the English: a word, not a name.
  assert.match(glossProblem('神（Kami）', 'god; kami') ?? '', /「Kami」/);
});

test('a part-of-speech label the English never had is stripped', () => {
  assert.equal(stripAddedLabel('（助詞）在；於', 'at; in'), '在；於');
  assert.equal(stripAddedLabel('（形容動詞、接尾詞）不；沒有', 'not'), '不；沒有');
  assert.equal(stripAddedLabel('（n,vs,vt,n-suf,adj-no）專用', 'exclusive use'), '專用');
  assert.match(glossProblem('（助詞）在；於', 'at; in') ?? '', /詞性標籤/);
});

test('a bracket the English opened with is a translation, and stays', () => {
  assert.equal(stripAddedLabel('（開關）關閉', '(switched) off'), '（開關）關閉');
  assert.equal(glossProblem('（開關）關閉', '(switched) off'), null);
  // Not a part-of-speech label at all.
  assert.equal(stripAddedLabel('（在上面）寫', 'to write (on top)'), '（在上面）寫');
});
