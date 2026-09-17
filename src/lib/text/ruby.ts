import { isKana, isKanji } from './kana.ts';

/**
 * A reading the text itself gives: the book's furigana over `start`..`end`.
 * Offsets are into the text with the markup removed.
 */
export interface RubySpan {
  start: number;
  end: number;
  /** As the book wrote it -- hiragana nearly always, katakana for some names. */
  reading: string;
}

/**
 * RUBY TRAVELS AS AOZORA MARKUP, `｜base《reading》`, inside the stored text.
 *
 * The book's furigana used to be thrown away at EPUB import: the analyzer owns
 * readings, and a second source could only disagree. But it is the author's own
 * answer where the analyzer has none or a wrong one -- a character's name above
 * all, which IPADIC reads by its pieces (千遥 as センハルカ, where the book prints
 * ちはる) -- so it is kept, and shown.
 *
 * Markup in the text rather than a side table, because `section.sourceText` is
 * what a section is rebuilt from, and every rebuild then gets the ruby back with
 * no second thing to keep in step. It is the notation Japanese web fiction and
 * Aozora Bunko already use, so text pasted from those arrives with its readings
 * too.
 *
 * Two forms, as Aozora defines them: `｜base《reading》` with the base marked
 * explicitly, and `漢字《かんじ》`, where the base is the run of kanji just before
 * the bracket. The reading must be kana, so 《》 used as title brackets --
 * 《源氏物語》 -- is left as text.
 */
export function extractRuby(marked: string): { text: string; spans: RubySpan[] } {
  let text = '';
  const spans: RubySpan[] = [];
  let index = 0;

  while (index < marked.length) {
    const char = marked[index]!;

    if (char === '｜') {
      const open = marked.indexOf('《', index + 1);
      const close = open === -1 ? -1 : marked.indexOf('》', open + 1);
      const base = open === -1 ? '' : marked.slice(index + 1, open);
      const reading = close === -1 ? '' : marked.slice(open + 1, close);
      if (base !== '' && !/[｜《》\n]/u.test(base) && isReading(reading)) {
        spans.push({ start: text.length, end: text.length + base.length, reading });
        text += base;
        index = close + 1;
        continue;
      }
    }

    if (char === '《') {
      const close = marked.indexOf('》', index + 1);
      const reading = close === -1 ? '' : marked.slice(index + 1, close);
      const baseStart = kanjiRunStart(text);
      if (baseStart < text.length && isReading(reading)) {
        spans.push({ start: baseStart, end: text.length, reading });
        index = close + 1;
        continue;
      }
    }

    text += char;
    index += 1;
  }
  return { text, spans };
}

/** The markup for one ruby, as EPUB import writes it. */
export function rubyMarkup(base: string, reading: string): string {
  return `｜${base}《${reading}》`;
}

function isReading(reading: string): boolean {
  return reading !== '' && [...reading].every((char) => isKana(char));
}

/** Where the run of kanji ending the text begins; `text.length` when there is none. */
function kanjiRunStart(text: string): number {
  let start = text.length;
  while (start > 0) {
    // Step back one code point, so an astral kanji is taken whole.
    const low = text.charCodeAt(start - 1);
    const width = low >= 0xdc00 && low <= 0xdfff && start >= 2 ? 2 : 1;
    if (!isKanji(text.slice(start - width, start))) break;
    start -= width;
  }
  return start;
}

/**
 * The spans that fall inside `start`..`end`, rebased to it -- how a section's
 * ruby is handed to each of its sentences. A span straddling the boundary
 * belongs to neither.
 */
export function spansWithin(spans: RubySpan[], start: number, end: number): RubySpan[] {
  return spans
    .filter((span) => span.start >= start && span.end <= end)
    .map((span) => ({ ...span, start: span.start - start, end: span.end - start }));
}
