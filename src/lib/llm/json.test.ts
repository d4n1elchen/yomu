import assert from 'node:assert/strict';
import { test } from 'node:test';
import { leadingJson } from './json.ts';

test('keeps the object and drops the explanation a model adds after it', () => {
  const reply = '{"spans":[{"n":1,"id":"none"}],"others":[]}\n\n說明：\n- 片段 1 …';
  assert.equal(leadingJson(reply), '{"spans":[{"n":1,"id":"none"}],"others":[]}');
});

test('a brace inside a string does not end the object', () => {
  assert.equal(leadingJson('{"gloss":"表示 } 的意思","n":1} tail'), '{"gloss":"表示 } 的意思","n":1}');
  assert.equal(leadingJson('{"q":"a \\" } b"} x'), '{"q":"a \\" } b"}');
});

test('prose with no JSON, or JSON cut off, gives nothing', () => {
  assert.equal(leadingJson('Let me analyze this sentence.'), null);
  assert.equal(leadingJson('{"spans":[{"n":1'), null);
});
