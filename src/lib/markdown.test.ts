import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseInline, parseMarkdown, type Block } from './markdown.ts';

const text = (blocks: Block[]) =>
  blocks.map((block) =>
    block.kind === 'list'
      ? block.items.map((item) => item.map((s) => s.text).join(''))
      : block.spans.map((s) => s.text).join(''),
  );

test('plain prose is one paragraph, newlines kept for pre-line', () => {
  const blocks = parseMarkdown('一行目\n二行目');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.kind, 'paragraph');
  assert.deepEqual(text(blocks), ['一行目\n二行目']);
});

test('a blank line separates paragraphs', () => {
  assert.deepEqual(text(parseMarkdown('第一段\n\n第二段')), ['第一段', '第二段']);
});

test('collects a bullet list', () => {
  const blocks = parseMarkdown('說明：\n- 第一點\n- 第二點');
  assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'list']);
  const list = blocks[1]!;
  assert.equal(list.kind === 'list' && list.ordered, false);
  assert.deepEqual(text(blocks)[1], ['第一點', '第二點']);
});

test('accepts the three bullet markers', () => {
  for (const marker of ['-', '*', '+']) {
    const blocks = parseMarkdown(`${marker} 項目`);
    assert.equal(blocks[0]!.kind, 'list', `marker ${marker} not treated as a list`);
  }
});

test('collects a numbered list and marks it ordered', () => {
  const blocks = parseMarkdown('1. 一\n2) 二');
  const list = blocks[0]!;
  assert.equal(list.kind === 'list' && list.ordered, true);
  assert.deepEqual(text(blocks)[0], ['一', '二']);
});

test('a change of list kind starts a new list', () => {
  const blocks = parseMarkdown('- 甲\n1. 乙');
  assert.deepEqual(blocks.map((b) => b.kind), ['list', 'list']);
});

test('reads a heading without leaving the hashes in the text', () => {
  const blocks = parseMarkdown('## 文法說明\n內容');
  assert.deepEqual(blocks.map((b) => b.kind), ['heading', 'paragraph']);
  assert.deepEqual(text(blocks), ['文法說明', '內容']);
});

test('marks bold and code runs', () => {
  const spans = parseInline('請看 **〜ている** 和 `masu` 形');
  assert.deepEqual(spans, [
    { text: '請看 ' },
    { text: '〜ている', bold: true },
    { text: ' 和 ' },
    { text: 'masu', code: true },
    { text: ' 形' },
  ]);
});

test('an unterminated bold marker stays literal', () => {
  // The whole point: the answer streams, so this text is seen mid-token. It
  // must not swallow the rest of the answer while the closing ** is in flight.
  assert.deepEqual(parseInline('這是 **未完成'), [{ text: '這是 **未完成' }]);
});

test('every partial prefix of a streamed answer parses without throwing', () => {
  const answer =
    '## 說明\n〜 **ている** 表示狀態。\n\n- 第一點 `code`\n- 第二點\n\n結論。';
  for (let i = 0; i <= answer.length; i += 1) {
    assert.doesNotThrow(() => parseMarkdown(answer.slice(0, i)), `broke at ${i}`);
  }
});

test('bold does not run across a line break', () => {
  // Two separate emphases on two lines must not merge into one bold run
  // spanning the newline between them.
  const blocks = parseMarkdown('**甲**\n**乙**');
  assert.deepEqual(
    (blocks[0]! as { spans: Array<{ text: string; bold?: boolean }> }).spans
      .filter((s) => s.bold)
      .map((s) => s.text),
    ['甲', '乙'],
  );
});

test('backticks win over asterisks inside them', () => {
  assert.deepEqual(parseInline('`**not bold**`'), [
    { text: '**not bold**', code: true },
  ]);
});

test('text with no markup produces a single plain span', () => {
  assert.deepEqual(parseInline('ただの文'), [{ text: 'ただの文' }]);
});

test('empty input produces no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n\n'), []);
});

test('a numbered list carries its starting ordinal', () => {
  const blocks = parseMarkdown(`3. 第三點
4. 第四點`);
  const list = blocks[0]!;
  assert.equal(list.kind === 'list' && list.start, 3);
});

test('numbered sections split by bullets keep counting up', () => {
  // What the model actually writes: numbered headings with bullets under each.
  // Each numbered run becomes its own `ol`, so without the ordinal carried they
  // would all restart and a four-part answer would read "1. ... 1. ... 1.".
  const blocks = parseMarkdown(`1. 第一節
- 細節
2. 第二節
- 細節
3. 第三節`);

  const starts = blocks
    .filter((block) => block.kind === 'list' && block.ordered)
    .map((block) => (block as { start?: number }).start);
  assert.deepEqual(starts, [1, 2, 3]);
});

test('an unordered list carries no ordinal', () => {
  const blocks = parseMarkdown(`- 甲
- 乙`);
  assert.equal(blocks[0]!.kind === 'list' && blocks[0]!.start, undefined);
});
