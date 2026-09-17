'use client';

import { withBookRuby } from '../lib/text/furigana.ts';
import type { RubySpan } from '../lib/text/ruby.ts';
import type { ArticleToken } from '../lib/article.ts';

/**
 * Furigana is always on -- it is the point of the reader, not a preference --
 * so there is no toggle and no bare-surface branch.
 *
 * Only a marked word is a target. Every other word is running text: no cursor
 * change, no focus stop, nothing inviting a tap that would open a card with
 * nothing in it worth stopping for. The dashed underline is the affordance,
 * and marking is what decides there is something to say.
 */
export function TokenSpan({
  token,
  marked,
  selected,
  bookRuby = [],
  bare = false,
  onSelect,
  onHover,
}: {
  token: ArticleToken;
  /** Above the difficulty slider: gets the dashed underline and the card. */
  marked: boolean;
  selected: boolean;
  /** The book's ruby inside this token, offsets relative to its surface. */
  bookRuby?: RubySpan[];
  /**
   * The token sits under a ruby that spans several tokens, which the sentence
   * draws around all of them -- so this one draws no furigana of its own.
   */
  bare?: boolean;
  onSelect: (token: ArticleToken, element: HTMLElement) => void;
  /** Null on the way out. Hover is the pointer affordance; tapping still works. */
  onHover: (token: ArticleToken | null, element: HTMLElement) => void;
}) {
  const className = ['token', marked ? 'marked' : '', selected ? 'selected' : '']
    .filter(Boolean)
    .join(' ');

  const segments = bare
    ? [{ text: token.surface, ruby: null }]
    : withBookRuby(token.surface, token.reading, bookRuby);
  const content = segments.map((segment, i) =>
    segment.ruby ? (
      <ruby key={i}>
        {segment.text}
        <rt>{segment.ruby}</rt>
      </ruby>
    ) : (
      <span key={i}>{segment.text}</span>
    ),
  );

  if (!marked) {
    return (
      <span className={className}>
        {content}
      </span>
    );
  }

  return (
    <span
      className={className}
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
