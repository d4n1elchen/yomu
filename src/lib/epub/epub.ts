import type { IngestSection, IngestWork } from '../import/ingest.ts';
import { xhtmlToText } from './xhtml.ts';
import { openZip, type Zip } from './zip.ts';

/**
 * An EPUB, read for the two things a pasted article cannot supply: where the
 * chapters are, and furigana that has not been flattened into the text.
 *
 * The format is opened at exactly the depth those need -- container, package,
 * navigation -- with regular expressions rather than an XML parser. That holds
 * because every file read here is machine-written by a publisher's toolchain
 * and none of it is the prose; `xhtmlToText` is where content is handled, and
 * it is equally a subset. If an EPUB ever arrives that this cannot open, the
 * failure is a thrown message at import, not a silently empty book.
 */

const CONTAINER_PATH = 'META-INF/container.xml';

/** XHTML and its older sibling. Anything else in the spine is not prose. */
const DOCUMENT_TYPES = new Set(['application/xhtml+xml', 'text/html']);

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'iu').exec(tag);
  if (!match) return null;
  return match[2] ?? match[3] ?? null;
}

/** `item/xhtml/../style/x.css` -> `item/style/x.css`, and URL escaping undone. */
function resolvePath(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const segment of decodeURIComponent(href).split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

/** A table-of-contents link points at a file, sometimes at a spot inside it. */
function withoutFragment(href: string): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

function firstText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'iu').exec(xml);
  if (!match) return null;
  const text = match[1]!.replace(/<[^>]*>/gu, '').trim();
  return text.length > 0 ? text : null;
}

function allTexts(xml: string, tag: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'giu');
  for (const match of xml.matchAll(pattern)) {
    const text = match[1]!.replace(/<[^>]*>/gu, '').trim();
    if (text.length > 0) found.push(text);
  }
  return found;
}

interface Package {
  /** Path of the .opf inside the archive; every href in it is relative to this. */
  path: string;
  title: string;
  author: string | null;
  /** Archive paths of the spine's prose documents, in reading order. */
  spine: string[];
  /** Archive path of the navigation document or NCX, when there is one. */
  navPath: string | null;
  navIsNcx: boolean;
}

function readPackage(zip: Zip): Package {
  if (!zip.has(CONTAINER_PATH)) {
    throw new Error('這不是 EPUB 檔（缺少 META-INF/container.xml）。');
  }
  const rootPath = attribute(
    /<rootfile\b[^>]*>/iu.exec(zip.readText(CONTAINER_PATH))?.[0] ?? '',
    'full-path',
  );
  if (!rootPath) throw new Error('EPUB 的 container.xml 沒有指向 OPF。');

  const path = decodeURIComponent(rootPath);
  if (!zip.has(path)) throw new Error(`EPUB 內找不到 OPF：${path}。`);
  const xml = zip.readText(path);

  const manifest = new Map<string, { href: string; type: string; properties: string }>();
  for (const match of xml.matchAll(/<item\b[^>]*>/giu)) {
    const tag = match[0];
    const id = attribute(tag, 'id');
    const href = attribute(tag, 'href');
    if (!id || !href) continue;
    manifest.set(id, {
      href,
      type: attribute(tag, 'media-type') ?? '',
      properties: attribute(tag, 'properties') ?? '',
    });
  }

  const spineTag = /<spine\b[^>]*>/iu.exec(xml)?.[0] ?? '';
  const spine: string[] = [];
  for (const match of xml.matchAll(/<itemref\b[^>]*>/giu)) {
    const idref = attribute(match[0], 'idref');
    const item = idref ? manifest.get(idref) : undefined;
    // Media overlays and fixed-layout images can sit in the spine too. Only
    // documents carry prose, and a non-document would strip to nothing anyway.
    if (item && DOCUMENT_TYPES.has(item.type)) {
      spine.push(resolvePath(path, item.href));
    }
  }
  if (spine.length === 0) throw new Error('EPUB 的 spine 沒有任何內文檔案。');

  // EPUB 3 marks its navigation document in the manifest; EPUB 2 points the
  // spine at an NCX. Both are read, because a file can carry either.
  let navPath: string | null = null;
  let navIsNcx = false;
  for (const item of manifest.values()) {
    if (item.properties.split(/\s+/u).includes('nav')) {
      navPath = resolvePath(path, item.href);
      break;
    }
  }
  if (!navPath) {
    const ncx = manifest.get(attribute(spineTag, 'toc') ?? '');
    if (ncx) {
      navPath = resolvePath(path, ncx.href);
      navIsNcx = true;
    }
  }

  return {
    path,
    title: firstText(xml, 'dc:title') ?? '未命名',
    // Light novels routinely credit an author, an illustrator and a studio as
    // three creators. Joining beats dropping two of them.
    author: allTexts(xml, 'dc:creator').join('／') || null,
    spine,
    navPath,
    navIsNcx,
  };
}

/**
 * The landmarks a book declares as navigation rather than content.
 *
 * `epub:type="cover"` and `epub:type="toc"` name the two pages that are about
 * the book instead of part of it -- and both are also listed in the table of
 * contents, so without this they arrive as the first two chapters. What they
 * hold is not the picture and the links a reader sees: stripped of markup, the
 * cover page is the shop's boilerplate about thumbnails and vertical layout,
 * and the contents page is the chapter titles again.
 *
 * Taken from the book's own declaration rather than from a guess about length,
 * because a short chapter is a real thing and a cover page is not.
 */
function readNavigationLandmarks(navPath: string, xml: string): Set<string> {
  const landmarks = new Set<string>();
  const section = /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\blandmarks\b[^"']*["'][\s\S]*?<\/nav>/iu.exec(
    xml,
  );
  if (!section) return landmarks;

  for (const match of section[0].matchAll(/<a\b[^>]*>/giu)) {
    const type = attribute(match[0], 'epub:type') ?? '';
    const href = attribute(match[0], 'href');
    if (!href) continue;
    if (type.split(/\s+/u).some((word) => word === 'cover' || word === 'toc')) {
      landmarks.add(resolvePath(navPath, withoutFragment(href)));
    }
  }
  return landmarks;
}

/** Where a chapter starts, keyed by the archive path its link resolves to. */
function readChapterTitles(zip: Zip, pkg: Package): Map<string, string> {
  const titles = new Map<string, string>();
  if (!pkg.navPath || !zip.has(pkg.navPath)) return titles;

  const navPath = pkg.navPath;
  const xml = zip.readText(navPath);
  const landmarks = pkg.navIsNcx
    ? new Set<string>()
    : readNavigationLandmarks(navPath, xml);

  // A nested table of contents can point several entries at one file. The first
  // is the one that names the chapter; the rest are places inside it, and this
  // splits by file.
  const remember = (href: string, label: string) => {
    const target = resolvePath(navPath, withoutFragment(href));
    if (landmarks.has(target)) return;
    if (!titles.has(target)) titles.set(target, label);
  };

  if (pkg.navIsNcx) {
    for (const match of xml.matchAll(/<navPoint\b[\s\S]*?<\/navPoint>/giu)) {
      const label = firstText(match[0], 'text');
      const src = attribute(/<content\b[^>]*>/iu.exec(match[0])?.[0] ?? '', 'src');
      if (label && src) remember(src, label);
    }
    return titles;
  }

  // The nav document holds several <nav>s -- toc, landmarks, page-list -- and
  // only the table of contents describes chapters.
  const toc = /<nav\b[^>]*epub:type\s*=\s*["'][^"']*\btoc\b[^"']*["'][\s\S]*?<\/nav>/iu.exec(
    xml,
  );

  for (const match of (toc?.[0] ?? xml).matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu)) {
    const href = attribute(match[0], 'href');
    const label = match[0].replace(/<[^>]*>/gu, '').trim();
    if (href && label.length > 0) remember(href, label);
  }
  return titles;
}

export interface EpubSection extends IngestSection {
  title: string | null;
  body: string;
  /** Characters of prose, so the importer can say what it is about to take on. */
  length: number;
  /** The chapter's numbered sections, when it has at least two. See `splitParts`. */
  parts?: EpubSection[];
}

/**
 * A line that is nothing but a section number: `１`, or `【２】`.
 *
 * Neither sample book lists its sections in the table of contents -- the
 * contents stops at chapters, and each chapter numbers its own parts in the
 * prose: カミュの歌鳥 with a bold `１` on its own line, 神椿市建設中。 with
 * `【１】`. So this is read from the text, not the navigation. Kanji numerals
 * count only inside brackets, because a bare `三` alone on a line is prose.
 */
const PART_MARKER = /^(?:【([0-9０-９]{1,3}|[一二三四五六七八九十]{1,4})】|([0-9０-９]{1,3}))$/u;

/**
 * SECTIONS COME FROM THE NUMBERS A CHAPTER PRINTS, and only when there are two.
 *
 * A chapter runs 5,000 to 30,000 characters, which is a long sitting; its
 * numbered parts are the book's own shorter stopping points. The number line
 * becomes the part's title and leaves the prose, where it would otherwise be
 * read as a sentence.
 *
 * One marker is not a split: 神椿市建設中。's epilogue carries a single heading,
 * and a chapter with one part is just the chapter. Anything before the first
 * marker -- an epigraph, a heading the markup put in the text -- joins the first
 * part rather than becoming an untitled section of its own.
 */
export function splitParts(body: string): EpubSection[] | undefined {
  const lines = body.split('\n');
  const starts: { line: number; title: string }[] = [];
  lines.forEach((line, index) => {
    const match = PART_MARKER.exec(line.trim());
    if (match) starts.push({ line: index, title: (match[1] ?? match[2])! });
  });
  if (starts.length < 2) return undefined;

  const parts = starts
    .map((start, i) => {
      const from = i === 0 ? 0 : start.line;
      const to = starts[i + 1]?.line ?? lines.length;
      const text = lines
        .slice(from, to)
        .filter((_, offset) => from + offset !== start.line)
        .join('\n')
        .trim();
      return { title: start.title, body: text, length: text.length };
    })
    // A number with no prose under it is not a section to open.
    .filter((part) => part.length > 0);
  return parts.length < 2 ? undefined : parts;
}

export interface ParsedEpub extends IngestWork {
  title: string;
  author: string | null;
  sourceType: string;
  sections: EpubSection[];
}

/**
 * CHAPTERS COME FROM THE TABLE OF CONTENTS, NOT FROM THE FILES.
 *
 * A spine document is not a chapter. Kadokawa's EPUBs put each chapter's 扉
 * image in its own file and the prose in the next one, so splitting per file
 * would produce fourteen sections for seven chapters, half of them empty. The
 * table of contents is the book's own answer to where a chapter begins: walk
 * the spine in order, start a new section at every document the contents links
 * to, and accumulate the ones it does not.
 *
 * Sections that strip to nothing are dropped -- a cover, a 扉 image, a page of
 * illustrations.
 *
 * ANYTHING BEFORE THE FIRST CHAPTER IS FRONT MATTER, and is dropped too. A
 * book's own contents is what says where the body begins, and the pages that
 * precede it are the ones nobody opens a novel to read: the shop's note about
 * thumbnails and vertical layout, an illustration credit, the contents page
 * itself. Keeping them made a freshly imported book open on its cover.
 *
 * A file with no table of contents keeps everything, as one untitled section.
 * There is nothing there to say where the body starts, and dropping the whole
 * book on the strength of a rule that cannot apply would be worse than reading
 * a credit line.
 */
export function parseEpub(file: Buffer): ParsedEpub {
  const zip = openZip(file);
  const pkg = readPackage(zip);
  const titles = readChapterTitles(zip, pkg);

  const sections: EpubSection[] = [];
  let open: { title: string | null; parts: string[] } | null = null;

  const close = () => {
    if (!open) return;
    const body = open.parts.join('\n').trim();
    if (body.length > 0) {
      const parts = splitParts(body);
      sections.push({
        title: open.title,
        body,
        length: body.length,
        ...(parts ? { parts } : {}),
      });
    }
    open = null;
  };

  // With a contents to go by, nothing is collected until the first chapter it
  // names. Without one, collection starts at the first document.
  let started = titles.size === 0;

  for (const path of pkg.spine) {
    const title = titles.get(path);
    if (title !== undefined) started = true;
    if (!started) continue;

    if (title !== undefined || open === null) {
      close();
      open = { title: title ?? null, parts: [] };
    }
    const text = xhtmlToText(zip.readText(path));
    if (text.length > 0) open.parts.push(text);
  }
  close();

  if (sections.length === 0) throw new Error('EPUB 裡沒有可讀的內文。');

  return {
    title: pkg.title,
    author: pkg.author,
    sourceType: 'file',
    sections,
  };
}
