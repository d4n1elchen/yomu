/**
 * A browser selection is a pair of DOM positions; our offsets are relative to
 * `sentence.text`. Mapping one onto the other is what makes selection-based Q&A
 * tractable, and the bridge is the token: every token span in the reader
 * carries the sentence it belongs to and its offsets within that sentence, so
 * the tokens a selection touches are enough to recover both.
 *
 * This module is the pure half -- the DOM half lives in `Reader`, which is the
 * only place that can see a `Selection`.
 */

export interface TouchedToken {
  sentenceId: string;
  charStart: number;
  charEnd: number;
}

export interface SelectionSpan {
  sentenceId: string;
  charStart: number;
  charEnd: number;
}

/**
 * Collapses the tokens a selection touched into one span per sentence.
 *
 * Spans are snapped outwards to whole tokens: dragging across half of 読み終わる
 * asks about 読み終わる, which is the question the reader meant. A selection may
 * cover several sentences, and each contributes its own span -- sentences are
 * separately addressed rows, so there is no single offset range that spans them.
 *
 * Order follows the first appearance of each sentence, which for a selection
 * dragged through the text is reading order.
 */
export function selectionSpans(touched: TouchedToken[]): SelectionSpan[] {
  const spans: SelectionSpan[] = [];
  const bySentence = new Map<string, SelectionSpan>();

  for (const token of touched) {
    const existing = bySentence.get(token.sentenceId);
    if (existing) {
      existing.charStart = Math.min(existing.charStart, token.charStart);
      existing.charEnd = Math.max(existing.charEnd, token.charEnd);
      continue;
    }
    const span: SelectionSpan = {
      sentenceId: token.sentenceId,
      charStart: token.charStart,
      charEnd: token.charEnd,
    };
    bySentence.set(token.sentenceId, span);
    spans.push(span);
  }

  return spans;
}
