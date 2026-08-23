'use client';

import { useState } from 'react';
import type { Lesson, LessonSentence, LessonToken } from '../lib/lesson.ts';
import { AskPanel } from './AskPanel.tsx';
import { TokenSpan } from './TokenSpan.tsx';
import { WordPanel } from './WordPanel.tsx';

export function LessonReader({ lesson }: { lesson: Lesson }) {
  const [furigana, setFurigana] = useState(true);
  const [selected, setSelected] = useState<LessonToken | null>(null);
  const [asking, setAsking] = useState<LessonSentence | null>(null);

  return (
    <>
      <div className="toolbar">
        <label>
          <input
            type="checkbox"
            checked={furigana}
            onChange={(event) => setFurigana(event.target.checked)}
          />
          ふりがな
        </label>
        <span className="spacer" />
        <a href="/library">library</a>
        <a href="/">← lessons</a>
      </div>

      <div className="reader">
        {lesson.sentences.map((sentence) => (
          <Sentence
            key={sentence.id}
            sentence={sentence}
            furigana={furigana}
            selectedId={selected?.id ?? null}
            asking={asking?.id === sentence.id}
            onSelect={(token) => {
              setSelected(token);
              setAsking(null);
            }}
            onAsk={() => {
              setAsking(sentence);
              setSelected(null);
            }}
          />
        ))}
      </div>

      {asking ? (
        <AskPanel
          sentenceId={asking.id}
          sentenceText={asking.text}
          onClose={() => setAsking(null)}
        />
      ) : selected ? (
        <WordPanel token={selected} onClose={() => setSelected(null)} />
      ) : null}
    </>
  );
}

function Sentence({
  sentence,
  furigana,
  selectedId,
  asking,
  onSelect,
  onAsk,
}: {
  sentence: LessonSentence;
  furigana: boolean;
  selectedId: string | null;
  asking: boolean;
  onSelect: (token: LessonToken) => void;
  onAsk: () => void;
}) {
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const token of sentence.tokens) {
    // Whitespace between tokens is not stored as a token, so it is read back
    // out of the sentence text. This also means any character the analyzer
    // skipped still reaches the page.
    if (token.charStart > cursor) {
      parts.push(
        <span key={`gap-${cursor}`}>
          {sentence.text.slice(cursor, token.charStart)}
        </span>,
      );
    }
    parts.push(
      <TokenSpan
        key={token.id}
        token={token}
        furigana={furigana}
        selected={token.id === selectedId}
        onSelect={onSelect}
      />,
    );
    cursor = token.charEnd;
  }

  if (cursor < sentence.text.length) {
    parts.push(<span key="gap-tail">{sentence.text.slice(cursor)}</span>);
  }

  const classes = ['sentence'];
  if (sentence.needsReview) classes.push('review');
  if (asking) classes.push('asking');

  return (
    <span
      // Anchor target for Library occurrence links, and the hook the Q&A
      // sentence selection will attach to.
      id={`sentence-${sentence.id}`}
      className={classes.join(' ')}
      data-sentence-id={sentence.id}
    >
      {parts}
      <button
        type="button"
        className="ask-btn"
        onClick={onAsk}
        aria-label="この文について質問"
        title="この文について質問"
      >
        ?
      </button>
    </span>
  );
}
