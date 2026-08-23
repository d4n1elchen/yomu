'use client';

import { alignFurigana } from '../lib/text/furigana.ts';
import { isPunctuationOnly } from '../lib/text/kana.ts';
import type { LessonToken } from '../lib/lesson.ts';

export function TokenSpan({
  token,
  furigana,
  selected,
  onSelect,
}: {
  token: LessonToken;
  furigana: boolean;
  selected: boolean;
  onSelect: (token: LessonToken) => void;
}) {
  const tappable = !isPunctuationOnly(token.surface);

  const className = [
    'token',
    tappable ? 'tappable' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const content = furigana ? (
    alignFurigana(token.surface, token.reading).map((segment, i) =>
      segment.ruby ? (
        <ruby key={i}>
          {segment.text}
          <rt>{segment.ruby}</rt>
        </ruby>
      ) : (
        <span key={i}>{segment.text}</span>
      ),
    )
  ) : (
    <>{token.surface}</>
  );

  if (!tappable) return <span className={className}>{content}</span>;

  return (
    <span
      className={className}
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
