import type { AnalyzedToken } from '../analyzer/types.ts';

export interface SegmentedSentence {
  text: string;
  /** Offsets into the text that was analyzed. */
  charStart: number;
  charEnd: number;
  /** Tokens still carrying absolute offsets; whitespace removed. */
  tokens: AnalyzedToken[];
}

const TERMINATORS = new Set(['。', '！', '？', '!', '?']);
const OPENERS = new Set(['「', '『', '（', '(', '【', '〈', '《', '〔', '｛', '［']);
const CLOSERS = new Set(['」', '』', '）', ')', '】', '〉', '》', '〕', '｝', '］']);

const isWhitespace = (t: AnalyzedToken) =>
  t.features.posDetail1 === '空白' || /^\s+$/.test(t.surface);

/**
 * Sentences are the anchor for Q&A and for grammar occurrences, so their
 * boundaries have to be stable and sane. Splitting the raw string on 。 is not
 * good enough: it breaks on 「…」 dialogue, on ……, and on '. ' inside Latin
 * text, all of which are everywhere in novels. Segmenting over the token
 * stream instead means the analyzer has already decided what a punctuation
 * mark is.
 *
 * Two rules do most of the work:
 *
 *   - Quote depth. A terminator inside an open quote does not end a sentence,
 *     so 「面白い！」と言った。 stays one sentence rather than splitting at the
 *     exclamation mark.
 *   - Newlines always break. Japanese prose rarely hard-wraps mid-sentence,
 *     and it bounds the damage when quotes turn out to be unbalanced -- which
 *     they routinely are in scraped and transcribed text.
 */
export function segmentSentences(
  text: string,
  tokens: AnalyzedToken[],
): SegmentedSentence[] {
  const sentences: SegmentedSentence[] = [];
  let current: AnalyzedToken[] = [];
  let depth = 0;
  let pending = false;

  const flush = () => {
    if (current.length === 0) return;
    const charStart = current[0]!.charStart;
    const charEnd = current[current.length - 1]!.charEnd;
    sentences.push({
      text: text.slice(charStart, charEnd),
      charStart,
      charEnd,
      tokens: current,
    });
    current = [];
    pending = false;
  };

  for (const token of tokens) {
    if (isWhitespace(token)) {
      // A newline ends the sentence; a plain space is left in the gap between
      // tokens, where the reader renders it back from sentence.text.
      if (token.surface.includes('\n')) {
        flush();
        depth = 0;
      }
      continue;
    }

    const surface = token.surface;

    if (pending) {
      // Trailing closers and runs like ！？ belong to the sentence being closed.
      if (CLOSERS.has(surface) || TERMINATORS.has(surface)) {
        current.push(token);
        if (CLOSERS.has(surface)) depth = Math.max(0, depth - 1);
        continue;
      }
      flush();
    }

    if (OPENERS.has(surface)) depth++;
    else if (CLOSERS.has(surface)) depth = Math.max(0, depth - 1);

    current.push(token);

    if (TERMINATORS.has(surface) && depth === 0) pending = true;
  }

  flush();
  return sentences;
}
