import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEpub } from './epub.ts';
import { buildEpub, buildZip } from './fixture.ts';

/** The shape both sample books have: a 扉 image page, then the chapter's prose. */
const kadokawa = () =>
  buildEpub({
    title: '神椿市建設中。NOVELIZED',
    creators: ['月島 総記', '咲の字。'],
    documents: [
      { name: 'p-cover.xhtml', body: '<svg><image xlink:href="../image/cover.jpg"/></svg>' },
      { name: 'p-002.xhtml', body: '<div id="toc-001"><svg><image/></svg></div>' },
      { name: 'p-003.xhtml', body: '<p>零章の本文。</p><p>つづき。</p>' },
      { name: 'p-004.xhtml', body: '<div id="toc-002"><svg><image/></svg></div>' },
      { name: 'p-005.xhtml', body: '<p>壱章の本文。</p>' },
    ],
    contents: [
      { href: 'p-cover.xhtml', label: '表紙' },
      { href: 'p-002.xhtml#toc-001', label: '零─『化歩の章』' },
      { href: 'p-004.xhtml#toc-002', label: '壱─『狸眼の章』' },
    ],
  });

test('takes the title and every creator from the package', () => {
  const book = parseEpub(kadokawa());
  assert.equal(book.title, '神椿市建設中。NOVELIZED');
  assert.equal(book.author, '月島 総記／咲の字。');
  assert.equal(book.sourceType, 'file');
});

test('a chapter spans the 扉 page and the prose file that follows it', () => {
  // The contents links at the image page, so splitting per spine document would
  // give four sections for two chapters, half of them empty.
  const book = parseEpub(kadokawa());
  assert.deepEqual(
    book.sections.map((s) => s.title),
    ['零─『化歩の章』', '壱─『狸眼の章』'],
  );
  assert.equal(book.sections[0]!.body, '零章の本文。\nつづき。');
  assert.equal(book.sections[1]!.body, '壱章の本文。');
});

test('drops a section with no prose, so a cover never becomes a chapter', () => {
  const book = parseEpub(kadokawa());
  assert.equal(
    book.sections.some((s) => s.title === '表紙'),
    false,
  );
});

/** What both sample books look like at the front: boilerplate, then a contents page. */
const withFrontMatter = () =>
  buildEpub({
    documents: [
      { name: 'p-cover.xhtml', body: '<p>本電子書籍は縦書きでレイアウトされています。</p>' },
      { name: 'p-credit.xhtml', body: '<p>口絵・本文イラスト●咲の字。</p>' },
      { name: 'p-toc.xhtml', body: '<p>目次</p><p>第一章</p><p>第二章</p>' },
      { name: 'p-01.xhtml', body: '<p>一章の本文。</p>' },
      { name: 'p-02.xhtml', body: '<p>二章の本文。</p>' },
      { name: 'p-colophon.xhtml', body: '<p>発行　株式会社。</p>' },
    ],
    contents: [
      { href: 'p-cover.xhtml', label: '表紙' },
      { href: 'p-toc.xhtml', label: '目次' },
      { href: 'p-01.xhtml', label: '第一章' },
      { href: 'p-02.xhtml', label: '第二章' },
      { href: 'p-colophon.xhtml', label: '奥付' },
    ],
    landmarks: [
      { href: 'p-cover.xhtml', type: 'cover' },
      { href: 'p-toc.xhtml', type: 'toc' },
    ],
  });

test('drops the cover and contents pages the landmarks declare', () => {
  // Both carry text once the markup is gone -- the shop's boilerplate and the
  // chapter titles again -- so emptiness would not have caught either.
  const book = parseEpub(withFrontMatter());
  assert.deepEqual(
    book.sections.map((s) => s.title),
    ['第一章', '第二章', '奥付'],
  );
});

test('drops everything before the first chapter the contents names', () => {
  const book = parseEpub(withFrontMatter());
  assert.equal(book.sections[0]!.body, '一章の本文。');
  assert.equal(
    book.sections.some((s) => s.body.includes('口絵')),
    false,
  );
});

test('keeps the colophon, because the contents lists it after the body', () => {
  const book = parseEpub(withFrontMatter());
  assert.equal(book.sections.at(-1)!.title, '奥付');
});

test('reports each chapter length, which is what the import decision rests on', () => {
  const book = parseEpub(kadokawa());
  assert.equal(book.sections[0]!.length, '零章の本文。\nつづき。'.length);
});

test('a document the contents skips joins the chapter it follows', () => {
  const book = parseEpub(
    buildEpub({
      documents: [
        { name: 'a.xhtml', body: '<p>前半。</p>' },
        { name: 'b.xhtml', body: '<p>後半。</p>' },
      ],
      contents: [{ href: 'a.xhtml', label: '第一章' }],
    }),
  );
  assert.equal(book.sections.length, 1);
  assert.equal(book.sections[0]!.body, '前半。\n後半。');
});

test('a nested contents entry does not split the file it points into', () => {
  const book = parseEpub(
    buildEpub({
      documents: [{ name: 'a.xhtml', body: '<p>一節。</p><p>二節。</p>' }],
      contents: [
        { href: 'a.xhtml', label: '第一章' },
        { href: 'a.xhtml#s2', label: '第一章 その二' },
      ],
    }),
  );
  assert.deepEqual(
    book.sections.map((s) => s.title),
    ['第一章'],
  );
});

test('reads an EPUB 2 table of contents out of the NCX', () => {
  const book = parseEpub(
    buildEpub({
      ncx: true,
      documents: [
        { name: 'a.xhtml', body: '<p>一章。</p>' },
        { name: 'b.xhtml', body: '<p>二章。</p>' },
      ],
      contents: [
        { href: 'a.xhtml', label: '第一章' },
        { href: 'b.xhtml', label: '第二章' },
      ],
    }),
  );
  assert.deepEqual(
    book.sections.map((s) => s.title),
    ['第一章', '第二章'],
  );
});

test('keeps the book readable as one untitled section when there is no contents', () => {
  const book = parseEpub(
    buildEpub({
      documents: [
        { name: 'a.xhtml', body: '<p>一。</p>' },
        { name: 'b.xhtml', body: '<p>二。</p>' },
      ],
      contents: [],
    }),
  );
  assert.deepEqual(
    book.sections.map((s) => s.title),
    [null],
  );
  assert.equal(book.sections[0]!.body, '一。\n二。');
});

test('strips ruby on the way through, which is the point of reading the file', () => {
  const book = parseEpub(
    buildEpub({
      documents: [
        { name: 'a.xhtml', body: '<p><ruby>頷<rt>うなず</rt></ruby>いた。</p>' },
      ],
      contents: [{ href: 'a.xhtml', label: '第一章' }],
    }),
  );
  assert.equal(book.sections[0]!.body, '頷いた。');
});

test('refuses a zip that is not an EPUB', () => {
  const zip = buildZip([{ name: 'readme.txt', body: 'hello' }]);
  assert.throws(() => parseEpub(zip), /EPUB/u);
});

test('refuses an EPUB whose documents hold no prose at all', () => {
  const book = buildEpub({
    documents: [{ name: 'a.xhtml', body: '<svg><image/></svg>' }],
    contents: [{ href: 'a.xhtml', label: '表紙' }],
  });
  assert.throws(() => parseEpub(book), /內文/u);
});
