'use client';

import { alignFurigana } from '../lib/text/furigana.ts';
import type { ArticleToken } from '../lib/article.ts';

/**
 * Furigana is always on -- it is the point of the reader, not a preference --
 * so there is no toggle and no bare-surface branch.
 *
 * Only a marked word is a target. Every other word is running text: no cursor
 * change, no focus stop, nothing inviting a tap that would open a card with
 * nothing in it worth stopping for. The dashed underline is the affordance,
 * and marking is what decides there is something to say.
 *
 * The data attributes are load-bearing on every token, marked or not: they are
 * how a browser selection is mapped back onto our sentence-relative offsets.
 * Punctuation carries them too, so a selection running through 「」 is not
 * silently clipped at the quotes.
 */
export function TokenSpan({
  token,
  marked,
  selected,
  onSelect,
  onHover,
}: {
  token: ArticleToken;
  /** Above the difficulty slider: gets the dashed underline and the card. */
  marked: boolean;
  selected: boolean;
  onSelect: (token: ArticleToken, element: HTMLElement) => void;
  /** Null on the way out. Hover is the pointer affordance; tapping still works. */
  onHover: (token: ArticleToken | null, element: HTMLElement) => void;
}) {
  const className = ['token', marked ? 'marked' : '', selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ');

  const content = alignFurigana(token.surface, token.reading).map((segment, i) =>
    segment.ruby ? (
      <ruby key={i}>
        {segment.text}
        <rt>{segment.ruby}</rt>
      </ruby>
    ) : (
      <span key={i}>{segment.text}</span>
    ),
  );

  const anchors = {
    'data-token': token.id,
    'data-sentence': token.sentenceId,
    'data-start': token.charStart,
    'data-end': token.charEnd,
  };

  if (!marked) {
    return (
      <span className={className} {...anchors}>
        {content}
      </span>
    );
  }

  return (
    <span
      className={className}
      {...anchors}
      role="button"
      // Ruby markup gives the element no computed name of its own, which would
      // leave the word announced as an unlabelled button.
      aria-label={token.surface}
      tabIndex={0}
      onClick={(event) => onSelect(token, event.currentTarget)}
      onMouseEnter={(event) => onHover(token, event.currentTarget)}
      onMouseLeave={(event) => onHover(null, event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(token, event.currentTarget);
        }
      }}
    >
      {content}
    </span>
  );
}
