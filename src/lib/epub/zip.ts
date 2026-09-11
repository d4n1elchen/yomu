import { inflateRawSync } from 'node:zlib';

/**
 * The smallest ZIP reader that can open an EPUB, because an EPUB is a ZIP and
 * nothing else in the format needs a library.
 *
 * Node already does the hard part: DEFLATE is `zlib.inflateRawSync`. What is
 * left is a header format -- a central directory listing name, method, sizes
 * and an offset per file. That is what this reads. Adding a zip dependency
 * would be a package for a struct layout, the same trade the Markdown parser
 * turned down.
 *
 * Entries are indexed, not inflated, because a 15 MB novel is mostly JPEGs and
 * the importer wants four XML files out of it.
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/** ZIP's own "this needs ZIP64" sentinel, in both the 32-bit size and count fields. */
const ZIP64_MARKER = 0xffffffff;

const STORED = 0;
const DEFLATED = 8;

interface Entry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface Zip {
  /** Entry names in central-directory order. */
  names: string[];
  has(name: string): boolean;
  /** Throws when the name is not in the archive -- a missing part is a corrupt EPUB. */
  read(name: string): Buffer;
  /** `read`, decoded as UTF-8 with any byte-order mark removed. */
  readText(name: string): string;
}

/**
 * The end-of-central-directory record sits last, but a trailing comment of up
 * to 65,535 bytes can follow it, so it has to be searched for backwards. Its
 * signature can also occur inside file data, which is why the match is only
 * accepted when the comment length it declares reaches exactly the end.
 */
function findEndOfCentralDirectory(buf: Buffer): number {
  const earliest = Math.max(0, buf.length - 0xffff - 22);
  for (let i = buf.length - 22; i >= earliest; i--) {
    if (buf.readUInt32LE(i) !== EOCD_SIG) continue;
    if (i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new Error('不是有效的 ZIP 檔（找不到目錄結尾）。');
}

export function openZip(buf: Buffer): Zip {
  const eocd = findEndOfCentralDirectory(buf);
  const count = buf.readUInt16LE(eocd + 10);
  const directoryOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64 is for archives past 4 GB or 65,535 entries. No EPUB is, and reading
  // the 32-bit fields anyway would silently address the wrong bytes -- so this
  // refuses rather than guesses.
  if (directoryOffset === ZIP64_MARKER || count === 0xffff) {
    throw new Error('不支援 ZIP64 格式的檔案。');
  }

  const entries = new Map<string, Entry>();
  const names: string[] = [];

  let p = directoryOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== CENTRAL_SIG) {
      throw new Error('ZIP 目錄結構損壞。');
    }
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);

    // Sizes come from here rather than from the local header: when an entry was
    // written with a streaming data descriptor its local header carries zeros,
    // and the central directory is the copy that was filled in afterwards.
    entries.set(name, {
      method: buf.readUInt16LE(p + 10),
      compressedSize: buf.readUInt32LE(p + 20),
      uncompressedSize: buf.readUInt32LE(p + 24),
      localOffset: buf.readUInt32LE(p + 42),
    });
    names.push(name);

    p += 46 + nameLength + extraLength + commentLength;
  }

  const read = (name: string): Buffer => {
    const entry = entries.get(name);
    if (!entry) throw new Error(`ZIP 內找不到 ${name}。`);

    const start = entry.localOffset;
    if (buf.readUInt32LE(start) !== LOCAL_SIG) {
      throw new Error(`ZIP 內 ${name} 的檔頭損壞。`);
    }
    // The local header's own extra field is allowed to differ in length from the
    // central directory's, so the data offset must be computed from this copy.
    const dataStart =
      start + 30 + buf.readUInt16LE(start + 26) + buf.readUInt16LE(start + 28);
    const raw = buf.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.method === STORED) return Buffer.from(raw);
    if (entry.method === DEFLATED) return inflateRawSync(raw);
    throw new Error(`ZIP 內 ${name} 使用不支援的壓縮方式（${entry.method}）。`);
  };

  return {
    names,
    has: (name) => entries.has(name),
    read,
    readText: (name) => read(name).toString('utf8').replace(/^﻿/u, ''),
  };
}
