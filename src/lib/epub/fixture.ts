import { crc32, deflateRawSync } from 'node:zlib';

/**
 * ZIP and EPUB fixtures for the tests next door.
 *
 * Built rather than committed, because the archives this code reads in anger
 * are copyrighted books. Writing the headers by hand also means a test knows
 * exactly what it put in -- including the awkward parts, like a stored entry
 * beside a deflated one, or a chapter whose 扉 image and prose live in
 * different files.
 *
 * Not imported by anything that ships.
 */

export interface ZipSource {
  name: string;
  body: string | Buffer;
  /** Stored rather than deflated, which is what a real EPUB does to `mimetype`. */
  stored?: boolean;
}

export function buildZip(sources: ZipSource[], comment = ''): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const source of sources) {
    const name = Buffer.from(source.name, 'utf8');
    const raw = Buffer.isBuffer(source.body)
      ? source.body
      : Buffer.from(source.body, 'utf8');
    const method = source.stored ? 0 : 8;
    const data = source.stored ? raw : deflateRawSync(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const tail = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(sources.length, 8);
  end.writeUInt16LE(sources.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(tail.length, 20);

  return Buffer.concat([...locals, directory, end, tail]);
}

export interface EpubSpec {
  title?: string;
  creators?: string[];
  /** Manifest and spine entries, in reading order. `body` is XHTML, not text. */
  documents: { name: string; body: string }[];
  /** Table-of-contents links, as written in the nav document: `href` may carry a fragment. */
  contents?: { href: string; label: string }[];
  /** Landmark entries, which is how a book declares its cover and contents pages. */
  landmarks?: { href: string; type: string }[];
  /** Write an EPUB 2 NCX instead of an EPUB 3 navigation document. */
  ncx?: boolean;
}

/** A package laid out the way the real files are: an `item/` directory beside `META-INF`. */
export function buildEpub(spec: EpubSpec): Buffer {
  const creators = spec.creators ?? ['作者'];
  const contents = spec.contents ?? [];

  const manifest = spec.documents
    .map(
      (doc, i) =>
        `<item id="d${i}" href="xhtml/${doc.name}" media-type="application/xhtml+xml"/>`,
    )
    .join('\n');
  const spine = spec.documents.map((_, i) => `<itemref idref="d${i}"/>`).join('\n');

  const navItem = spec.ncx
    ? '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
    : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>';

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title id="title">${spec.title ?? '書名'}</dc:title>
${creators.map((c, i) => `    <dc:creator id="id-${i}">${c}</dc:creator>`).join('\n')}
    <dc:language>ja</dc:language>
  </metadata>
  <manifest>
${navItem}
${manifest}
  </manifest>
  <spine${spec.ncx ? ' toc="ncx"' : ''}>
${spine}
  </spine>
</package>`;

  const nav = spec.ncx
    ? `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<navMap>
${contents
  .map(
    (entry, i) =>
      `<navPoint id="n${i}" playOrder="${i + 1}"><navLabel><text>${entry.label}</text></navLabel><content src="xhtml/${entry.href}"/></navPoint>`,
  )
  .join('\n')}
</navMap>
</ncx>`
    : `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
<nav epub:type="toc" id="toc"><h1>Navigation</h1><ol>
${contents.map((entry) => `<li><a href="xhtml/${entry.href}">${entry.label}</a></li>`).join('\n')}
</ol></nav>
<nav epub:type="landmarks" id="guide"><ol>
${(spec.landmarks ?? [])
  .map(
    (mark) =>
      `<li><a epub:type="${mark.type}" href="xhtml/${mark.href}">${mark.type}</a></li>`,
  )
  .join('\n')}
<li><a epub:type="bodymatter" href="xhtml/${spec.documents[0]?.name ?? ''}">本編</a></li>
</ol></nav>
</body>
</html>`;

  return buildZip([
    { name: 'mimetype', body: 'application/epub+zip', stored: true },
    {
      name: 'META-INF/container.xml',
      body: `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
<rootfiles><rootfile full-path="item/standard.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    },
    { name: 'item/standard.opf', body: opf },
    { name: spec.ncx ? 'item/toc.ncx' : 'item/nav.xhtml', body: nav },
    ...spec.documents.map((doc) => ({
      name: `item/xhtml/${doc.name}`,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title></head><body>${doc.body}</body></html>`,
    })),
  ]);
}
