import assert from 'node:assert/strict';
import test from 'node:test';
import { xhtmlToText } from './xhtml.ts';

test('keeps the base text of a ruby and drops the reading', () => {
  const text = xhtmlToText('<p><ruby><rb>頷</rb><rt>うなず</rt></ruby>いた。</p>');
  assert.equal(text, '頷いた。');
});

test('drops the reading through the spans a publisher wraps it in', () => {
  // Kadokawa's files wrap every run in a kobo span, inside the ruby as well as
  // outside it, which is what defeats a naive <ruby>(.*)<rt> match.
  const text = xhtmlToText(
    '<p><span class="koboSpan" id="kobo.5.1">「</span>' +
      '<ruby><span class="koboSpan" id="kobo.6.1">化</span><rt>か</rt></ruby>' +
      '<span class="koboSpan" id="kobo.7.1">……</span>' +
      '<ruby><span class="koboSpan" id="kobo.8.1">歩</span><rt>ふ</rt></ruby>' +
      '<span class="koboSpan" id="kobo.9.1">ちゃ……」</span></p>',
  );
  assert.equal(text, '「化……歩ちゃ……」');
});

test('drops the parentheses a fallback renderer would show around a reading', () => {
  const text = xhtmlToText('<p><ruby>漢字<rp>（</rp><rt>かんじ</rt><rp>）</rp></ruby></p>');
  assert.equal(text, '漢字');
});

test('gives every paragraph its own line, because the reader breaks on them', () => {
  const text = xhtmlToText('<p>一行目。</p>\n  <p>二行目。</p>');
  assert.equal(text, '一行目。\n二行目。');
});

test('treats a line break as a line break', () => {
  assert.equal(xhtmlToText('<p>上<br/>下</p>'), '上\n下');
});

test('drops the empty paragraphs used as vertical spacing', () => {
  assert.equal(xhtmlToText('<p>本文。</p><p><br/></p><p>次。</p>'), '本文。\n次。');
});

test('does not run a chapter together when tags are self-closed', () => {
  assert.equal(xhtmlToText('<div>一。</div><p />二。'), '一。\n二。');
});

test('leaves out the head, scripts and stylesheets', () => {
  const text = xhtmlToText(
    '<html><head><title>書名</title><style>p{color:red}</style></head>' +
      '<body><script>var a = 1;</script><p>本文。</p></body></html>',
  );
  assert.equal(text, '本文。');
});

test('leaves out an SVG, which is how a 扉 page carries its image', () => {
  const text = xhtmlToText(
    '<div class="main" id="toc-001"><svg viewBox="0 0 1443 2048">' +
      '<image xlink:href="../image/tobira01.jpg"/></svg></div>',
  );
  assert.equal(text, '');
});

test('decodes entities, and decodes an escaped ampersand only once', () => {
  assert.equal(xhtmlToText('<p>A&amp;B</p>'), 'A&B');
  assert.equal(xhtmlToText('<p>&amp;lt;</p>'), '&lt;');
  assert.equal(xhtmlToText('<p>&#x3042;&#12356;</p>'), 'あい');
});

test('leaves an unknown entity alone rather than eating it', () => {
  assert.equal(xhtmlToText('<p>&bogus;</p>'), '&bogus;');
});

test('collapses the indentation of the source but not a full-width space', () => {
  // U+3000 between a chapter number and its title is text. The ASCII runs
  // around the markup are not.
  assert.equal(xhtmlToText('<h1>  １　エコーノイズ  </h1>'), '１　エコーノイズ');
});

test('drops the full-width space a paragraph is indented with', () => {
  assert.equal(xhtmlToText('<p>　友達の声に振り向いた。</p>'), '友達の声に振り向いた。');
});

test('ignores a comment, including one that wraps markup', () => {
  assert.equal(xhtmlToText('<p>前<!-- <p>隱藏</p> -->後</p>'), '前後');
});
