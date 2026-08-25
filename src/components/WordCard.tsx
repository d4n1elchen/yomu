'use client';

import { useEffect } from 'react';
import type { ArticleSense, ArticleToken } from '../lib/article.ts';
import { toHiragana } from '../lib/text/kana.ts';
import { posLabel } from '../lib/text/pos.ts';
import { anchorStyle, useCardAnchor, type AnchorRect } from './useCardAnchor.ts';

/**
 * The word card. A bubble hanging off the word on a desktop screen, and the
 * bottom sheet it used to be everywhere on a phone -- where an anchored bubble
 * would cover the word it is describing.
 *
 * The split is one media query in `globals.css`; the anchoring is
 * `useCardAnchor`, shared with the Q&A card so the two cannot drift apart.
 *
 * The headword is the dictionary form, not the form on the page: you hovered
 * 眺め and the thing to look up is 眺める. The inflected form is shown
 * underneath rather than being silently swapped out from under you.
 */
export function WordCard({
  token,
  senses,
  learning,
  onToggleLearning,
  rect,
  onClose,
  onPointerEnter,
  onPointerLeave,
}: {
  token: ArticleToken;
  senses: ArticleSense[];
  /** Whether this word is already on the 生詞 list. */
  learning: boolean;
  onToggleLearning: () => void;
  rect: AnchorRect;
  onClose: () => void;
  /** Hovering the card itself keeps it open on the way over from the word. */
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}) {
  const cardRef = useCardAnchor<HTMLDivElement>(rect);
  const reading = token.lemmaReading ? toHiragana(token.lemmaReading) : null;
  const inflected = token.lemma !== token.surface;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="word-card"
      role="dialog"
      aria-label={`${token.lemma} 的說明`}
      ref={cardRef}
      style={anchorStyle(rect)}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="word-head">
        <span className="word-lemma" lang="ja">
          {token.lemma}
        </span>
        {reading ? (
          <span className="word-reading" lang="ja">
            {reading}
          </span>
        ) : (
          <span className="word-unknown">讀音未知</span>
        )}
        <span className="word-pos">{posLabel(token.pos)}</span>
        <button type="button" className="close" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

      {inflected ? (
        <p className="word-inflected">
          文中形{' '}
          <span lang="ja">{token.surface}</span>
        </p>
      ) : null}

      {senses.length > 0 ? (
        <ol className="word-senses">
          {senses.map((sense, index) => (
            <li key={index}>
              {sense.zh ? <span className="gloss-zh">{sense.zh}</span> : null}
              {/*
                JMdict's own gloss. Once Phase C has translated the sense this
                sits under the Chinese as the source it was translated from;
                until then it is all the card has, so it is not dimmed.
              */}
              <span className={sense.zh ? 'gloss-en' : 'gloss-en sole'} lang="en">
                {sense.en}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="word-empty">辭典中沒有這個詞。</p>
      )}

      <div className="word-actions">
        {/*
          The word stays underlined either way -- marking is statistical and this
          list is not -- so this toggle is reversible right here, on the same
          word, rather than needing somewhere else to undo it.
        */}
        <button
          type="button"
          className={learning ? 'learn on' : 'learn'}
          onClick={onToggleLearning}
          aria-pressed={learning}
        >
          <span aria-hidden="true">{learning ? '★' : '☆'}</span>
          {learning ? '已標為生詞' : '標為生詞'}
        </button>
        <a className="word-more" href={`/dictionary/${token.lexemeId}`}>
          辭典
        </a>
      </div>
    </div>
  );
}
