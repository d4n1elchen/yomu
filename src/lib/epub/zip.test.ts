import assert from 'node:assert/strict';
import test from 'node:test';
import { buildZip } from './fixture.ts';
import { openZip } from './zip.ts';

test('reads a deflated entry back as it went in', () => {
  const body = 'ひらがな'.repeat(500);
  const zip = openZip(buildZip([{ name: 'item/text.xhtml', body }]));
  assert.equal(zip.readText('item/text.xhtml'), body);
});

test('reads a stored entry, which is how mimetype is written', () => {
  const zip = openZip(
    buildZip([{ name: 'mimetype', body: 'application/epub+zip', stored: true }]),
  );
  assert.equal(zip.readText('mimetype'), 'application/epub+zip');
});

test('lists names in directory order and answers has()', () => {
  const zip = openZip(
    buildZip([
      { name: 'META-INF/container.xml', body: '<container/>' },
      { name: 'item/standard.opf', body: '<package/>' },
    ]),
  );
  assert.deepEqual(zip.names, ['META-INF/container.xml', 'item/standard.opf']);
  assert.equal(zip.has('item/standard.opf'), true);
  assert.equal(zip.has('item/missing.opf'), false);
});

test('strips a byte-order mark, which publishers do emit', () => {
  const body = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('<opf/>')]);
  const zip = openZip(buildZip([{ name: 'a.opf', body }]));
  assert.equal(zip.readText('a.opf'), '<opf/>');
});

test('finds the directory past a trailing comment', () => {
  const zip = openZip(buildZip([{ name: 'a.txt', body: 'hello' }], 'x'.repeat(400)));
  assert.equal(zip.readText('a.txt'), 'hello');
});

test('is not fooled by the end signature appearing inside file data', () => {
  // The four bytes of the end-of-directory signature, sitting in an entry that
  // is stored rather than compressed -- so they survive verbatim into the file
  // and a backwards search meets them before the real record.
  const decoy = Buffer.alloc(64);
  decoy.writeUInt32LE(0x06054b50, 30);
  const zip = openZip(buildZip([{ name: 'decoy.bin', body: decoy, stored: true }]));
  assert.equal(zip.read('decoy.bin').length, 64);
});

test('names a missing entry rather than returning empty', () => {
  const zip = openZip(buildZip([{ name: 'a.txt', body: 'hello' }]));
  assert.throws(() => zip.read('b.txt'), /b\.txt/u);
});

test('refuses something that is not a zip at all', () => {
  assert.throws(() => openZip(Buffer.from('這是一段純文字，不是壓縮檔。')), /ZIP/u);
});
