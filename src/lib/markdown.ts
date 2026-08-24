/**
 * A deliberately small Markdown subset, for one job: rendering the Q&A answer.
 *
 * Not a Markdown implementation and not trying to be. The grammar prompt asks
 * for 條列式 explanations, so what actually arrives is bullets, the occasional
 * numbered list, bold for the form under discussion, and prose. Pulling in the
 * remark/micromark tree for that would be about thirty packages to render four
 * constructs, in a project whose only dependencies are the framework, the
 * database and the analyzer.
 *
 * Two constraints shape it:
 *
 * 1. **It parses partial input, constantly.** The answer streams, so this runs
 *    again on every chunk against text that is mid-sentence and mid-syntax. An
 *    unterminated `**` must stay literal rather than swallowing the rest of the
 *    answer and making it flicker bold as the closing marker arrives.
 * 2. **It never produces HTML.** The output is data; the component turns it into
 *    React elements, which escape their text. Model output is untrusted input,
 *    and `dangerouslySetInnerHTML` anywhere near it would be the whole problem.
 *
 * Unsupported on purpose: links, images, tables, blockquotes, raw HTML, nested
 * lists. None appear in a grammar explanation, and each is surface area.
 */

export interface Span {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type Block =
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'heading'; spans: Span[] }
  | { kind: 'list'; ordered: boolean; start?: number; items: Span[][] };

/**
 * Splits one line into plain, bold and code runs.
 *
 * Both patterns require their closing delimiter, which is what makes a partial
 * stream render sensibly: `**まだ` is text until its `**` arrives. Code is
 * matched first so that backticks win over asterisks inside them.
 */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /`([^`\n]+)`|\*\*([^\n]+?)\*\*/g;
  let last = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    if (at > last) spans.push({ text: text.slice(last, at) });
    if (match[1] !== undefined) spans.push({ text: match[1], code: true });
    else spans.push({ text: match[2]!, bold: true });
    last = at + match[0].length;
  }

  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

const HEADING = /^\s{0,3}#{1,6}\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/;

/**
 * Groups lines into blocks.
 *
 * Consecutive prose lines stay one paragraph joined by newlines rather than
 * becoming a paragraph each: the bubble keeps `white-space: pre-line`, so a
 * single-newline break inside an answer survives exactly as it did before any
 * of this existed.
 */
export function parseMarkdown(input: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; start?: number; items: Span[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: 'paragraph', spans: parseInline(paragraph.join('\n')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ...list });
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const line of input.split('\n')) {
    if (line.trim() === '') {
      flush();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: 'heading', spans: parseInline(heading[1]!.trim()) });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = numbered !== null;
      // A list that changes marker mid-run is two lists, not one with a
      // confused numbering.
      if (list && list.ordered !== ordered) flushList();
      // The ordinal is carried rather than left to the browser. The model
      // writes numbered sections with bullets underneath, which splits one
      // logical list into several `ol`s -- and each would restart at 1, so a
      // four-part answer rendered as "1. 1. 1. 1.".
      list ??= ordered
        ? { ordered, start: Number(numbered![1]), items: [] }
        : { ordered, items: [] };
      list.items.push(parseInline((bullet?.[1] ?? numbered![2]!).trim()));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flush();
  return blocks;
}
