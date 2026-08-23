'use client';

import { alignFurigana } from '../lib/text/furigana.ts';
import { isPunctuationOnly } from '../lib/text/kana.ts';
import type { ArticleToken } from '../lib/article.ts';

/**
 * Furigana is always on -- it is the point of the reader, not a preference --
 * so there is no toggle and no bare-surface branch.
 *
 * The data attributes are load-bearing: they are how a browser selection is
 * mapped back onto our sentence-relative offsets. Every token carries them,
 * punctuation included, so a selection that runs through 「」 is not silently
 * clipped at the quotes.
 */
export function TokenSpan({
  token,
  explain,
  selected,
  onSelect,
}: {
  token: ArticleToken;
  /** Word explanations are switched off; the word is text, not a control. */
  explain: boolean;
  selected: boolean;
  onSelect: (token: ArticleToken) => void;
}) {
  const tappable = explain && !isPunctuationOnly(token.surface);

  const className = ['token', tappable ? 'tappable' : '', selected ? 'selected' : '']
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

  if (!tappable) {
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
      // leave every word announced as an unlabelled button.
      aria-label={token.surface}
      tabIndex={0}
      onClick={() => onSelect(token)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(token);
        }
      }}
    >
      {content}
    </span>
  );
}
