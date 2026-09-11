/**
 * Plain text out of an EPUB's XHTML, without a DOM.
 *
 * Four constructs matter and the rest is chrome: ruby, line breaks, block
 * boundaries, and entities. That is the same shape as the Markdown renderer's
 * subset, and it is a subset for the same reason -- a parser this size is
 * readable, and the alternative is a dependency that parses HTML we do not
 * otherwise care about.
 */

/**
 * RUBY IS THE WHOLE POINT, and it is dropped rather than kept.
 *
 * `<ruby><rb>頷</rb><rt>うなず</rt></ruby>` yields 頷 -- base text only. This is
 * the same furigana whose *flattened* form (頷うなずいた, what a copy-paste from
 * a rendered page produces) is the single largest class of unmatched word in
 * the corpus, and it corrupts more than matching: the reader prints the reading
 * as running text, the Dictionary gains a junk single-kanji entry, and the
 * vocabulary count is inflated by both halves.
 *
 * Reading the markup means that never happens. The reading is thrown away
 * because the analyzer owns readings -- it derives one for 頷いた from the
 * lemma, and a second source for the same fact could only disagree with it. If
 * the two are ever reconciled, `<rt>` is where the book's own answer was.
 */
const RUBY_ANNOTATION = /<(rt|rp)\b[^>]*>[\s\S]*?<\/\1>/giu;

/** Not prose: markup, scripts, stylesheets, and the SVG that carries a 扉 image. */
const NON_PROSE = /<(head|script|style|svg)\b[^>]*>[\s\S]*?<\/\1>/giu;

/** Comments can wrap anything, including tags, so they go before tags do. */
const COMMENT = /<!--[\s\S]*?-->/gu;

/** A line break in the source is a line break in the text. */
const LINE_BREAK = /<br\b[^>]*\/?>/giu;

/**
 * Block ends, which is where a paragraph boundary actually lives. The reader
 * needs these: segmentation treats a newline as a paragraph start, so losing
 * them would run a whole chapter together as a single paragraph.
 */
const BLOCK_END = /<\/(p|div|h[1-6]|li|tr|blockquote|section|article)\s*>/giu;

/** Self-closing block tags, which end a block without a closing tag to match. */
const SELF_CLOSING_BLOCK = /<(p|div|hr)\b[^>]*\/>/giu;

const TAG = /<[^>]*>/gu;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * Every entity resolves in one pass, `&amp;` included. Substituting it last
 * instead would decode `&amp;lt;` twice and turn an escaped ampersand into a
 * tag bracket.
 */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    if (lower.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isNaN(code) ? whole : String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[lower] ?? whole;
  });
}

/**
 * One line per paragraph, blank lines dropped.
 *
 * XHTML is indented, so the source is full of newlines that are formatting
 * rather than text. Only the breaks this function inserted are real, which is
 * why every other run of whitespace collapses before the lines are split.
 */
export function xhtmlToText(xhtml: string): string {
  const withBreaks = xhtml
    .replace(COMMENT, '')
    .replace(NON_PROSE, '')
    .replace(RUBY_ANNOTATION, '')
    .replace(LINE_BREAK, '\n')
    .replace(SELF_CLOSING_BLOCK, '\n')
    .replace(BLOCK_END, '\n');

  const text = decodeEntities(withBreaks.replace(TAG, ''));

  return text
    .split('\n')
    // Only ASCII runs collapse. U+3000 is text rather than layout -- it is what
    // separates a chapter number from its title -- and rewriting it to a space
    // would edit the book. `trim` still takes it off the ends, which is where it
    // is the paragraph indent the reader already draws for itself.
    .map((line) => line.replace(/[ \t\f\v\r]+/gu, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
