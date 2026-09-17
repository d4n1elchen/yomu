'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toggleLearning } from '../app/read/actions.ts';
import type { Article, ArticleSentence, ArticleToken } from '../lib/article.ts';
import { DownloadChapter } from './DownloadChapter.tsx';
import { DEFAULT_LEVEL, MAX_BAND, isHardWord } from '../lib/marking.ts';
import { AskDialog, type AskTarget } from './AskDialog.tsx';
import { ReadStamp } from './ReadStamp.tsx';
import { ReadingProgress } from './ReadingProgress.tsx';
import { TokenSpan } from './TokenSpan.tsx';
import { WordCard } from './WordCard.tsx';
import type { AnchorRect } from './useCardAnchor.ts';

/**
 * Long enough to cross the gap between a word and the card hanging off it,
 * short enough that the card does not linger over text you have moved on from.
 */
const HOVER_GRACE_MS = 140;

/** A card is open on this word, anchored to where the word was on screen. */
interface OpenWord {
  token: ArticleToken;
  rect: AnchorRect;
}

function anchorOf(element: HTMLElement): AnchorRect {
  const rect = element.getBoundingClientRect();
  return { top: rect.top, bottom: rect.bottom, left: rect.left };
}

/**
 * Two taps closer than this, in time and on screen, are a double tap. 300ms is
 * the interval iOS itself uses to tell a double tap from two taps; the distance
 * forgives a thumb that lands a few pixels off the first time.
 */
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_SLOP_PX = 24;

interface Tap {
  time: number;
  x: number;
  y: number;
  sentenceId: string;
}

export function Reader({ article }: { article: Article }) {
  const [explain, setExplain] = useState(true);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [word, setWord] = useState<OpenWord | null>(null);
  // The 生詞 list, held as group keys so that 見る and 観る toggle together --
  // the same grouping the Dictionary lists them under.
  const [learning, setLearningKeys] = useState<Set<string>>(
    () => new Set(article.learning),
  );
  const [asking, setAsking] = useState<AskTarget | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastTap = useRef<Tap | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `entryId ?? lexemeId` is `coalesce(dict_entry_id, lexeme.id)` -- the
  // Dictionary's own grouping, so a word reads the same in both places.
  const groupKey = (token: ArticleToken) => token.entryId ?? token.lexemeId;

  const onToggleLearning = useCallback((token: ArticleToken) => {
    const key = token.entryId ?? token.lexemeId;
    setLearningKeys((current) => {
      const next = new Set(current);
      const on = !next.has(key);
      if (on) next.add(key);
      else next.delete(key);
      // Optimistic: the list is a note to yourself, and waiting for a round trip
      // to see a star fill in would be the only slow thing on the page.
      //
      // Swallowed because this same reader runs offline, where the action cannot
      // reach the server at all. The mark holds for the session and is lost on
      // reload, which is the honest outcome and better than an unhandled
      // rejection in the console of a page that is working as designed.
      void toggleLearning(token.lexemeId, on).catch(() => {});
      return next;
    });
  }, []);

  const marked = useCallback(
    (token: ArticleToken) => explain && isHardWord(token, level),
    [explain, level],
  );

  // Consecutive sentences flow within a paragraph; a sentence marked as opening
  // one starts the next. A newline in the source is the only paragraph boundary,
  // so a run of 。-separated sentences reads as prose rather than a stack of
  // lines. A leading sentence not flagged (older data) still starts a paragraph.
  const paragraphs = useMemo(() => {
    const groups: ArticleSentence[][] = [];
    for (const sentence of article.sentences) {
      if (sentence.paragraphStart || groups.length === 0) groups.push([sentence]);
      else groups[groups.length - 1]!.push(sentence);
    }
    return groups;
  }, [article.sentences]);

  // Distinct words, not occurrences: the count sits under a control for how
  // much of the vocabulary is unfamiliar, and a word appearing twice is one
  // word you either know or do not.
  const markedCount = useMemo(() => {
    const found = new Set<string>();
    for (const sentence of article.sentences) {
      for (const token of sentence.tokens) {
        if (isHardWord(token, level)) found.add(token.lexemeId);
      }
    }
    return found.size;
  }, [article.sentences, level]);

  useEffect(
    () => () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    },
    [],
  );

  const hold = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };

  const onSelectToken = (token: ArticleToken, element: HTMLElement) => {
    // A drag that begins and ends inside one word still fires a click. That is
    // a selection, not a tap, and the word card must not cover it.
    if (window.getSelection()?.isCollapsed === false) return;
    hold();
    setWord({ token, rect: anchorOf(element) });
  };

  /**
   * Hovering a marked word opens its card; leaving closes it, but not at once.
   * The card is a fixed-position element rather than a child of the word, so
   * the pointer is over neither of them on the way between the two -- closing
   * on the first `mouseleave` would put the card out of reach.
   */
  const onHoverToken = (token: ArticleToken | null, element: HTMLElement) => {
    if (token === null) {
      hold();
      closeTimer.current = setTimeout(() => setWord(null), HOVER_GRACE_MS);
      return;
    }
    // An open Q&A card wins over a word card, the same rule a double tap
    // follows. Mid-drag the pointer also sweeps over words on its way to the end
    // of a selection, and none of those crossings is a request to explain
    // anything.
    if (asking || dragging.current) return;
    hold();
    setWord({ token, rect: anchorOf(element) });
  };

  // Only tracks whether a mouse button is down, so sweeping across words while
  // dragging out a selection to copy does not pop a card open on each of them.
  useEffect(() => {
    const onPointerDown = () => {
      dragging.current = true;
    };
    const onPointerUp = () => {
      dragging.current = false;
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, []);

  /**
   * A double tap anywhere in a sentence asks about that sentence.
   *
   * This replaced opening the card on a text selection, which is a fiddly
   * gesture on a phone: iOS selects by long press, then asks you to drag
   * handles to the ends of what you meant. A sentence -- as segmentation
   * already cut it, through its 。 and any closing quote -- is nearly always
   * the unit the question is about anyway, and the model is sent the sentences
   * either side for context.
   *
   * Detected by hand from `pointerup` rather than `dblclick`, which iOS Safari
   * does not reliably deliver for touch. `touch-action: manipulation` on the
   * reader is what stops the same double tap from zooming the page.
   *
   * The first tap still does what a tap does, so double-tapping a marked word
   * flashes its card before the Q&A card replaces it. Holding every tap back
   * 300ms to rule out a second one would make the word card, the thing tapped
   * far more often, feel slow.
   */
  const onReaderPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = (event.target as Element).closest('[data-sentence-id]');
    const sentenceId = element?.getAttribute('data-sentence-id');
    if (!element || !sentenceId) {
      lastTap.current = null;
      return;
    }

    const tap: Tap = {
      time: event.timeStamp,
      x: event.clientX,
      y: event.clientY,
      sentenceId,
    };
    const previous = lastTap.current;
    const isDouble =
      previous !== null &&
      previous.sentenceId === sentenceId &&
      tap.time - previous.time < DOUBLE_TAP_MS &&
      Math.hypot(tap.x - previous.x, tap.y - previous.y) < DOUBLE_TAP_SLOP_PX;

    if (!isDouble) {
      lastTap.current = tap;
      return;
    }

    // A third tap starts over rather than counting as a second double tap.
    lastTap.current = null;
    const sentence = article.sentences.find((s) => s.id === sentenceId);
    if (!sentence) return;

    const rect = element.getBoundingClientRect();
    setAsking({
      sentenceId,
      text: sentence.text,
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left },
    });
    // The Q&A card and a word card are two answers to the same gesture; the
    // Q&A card wins.
    hold();
    setWord(null);
  };

  return (
    <>
      <ReadStamp sectionId={article.sectionId} />
      <ReadingProgress
        sectionId={article.sectionId}
        sentenceId={article.progressSentenceId ?? null}
        root={rootRef}
      />

      <div className="reader-controls">
        <DownloadChapter article={article} />
        <label className={`switch ${explain ? 'on' : ''}`}>
          <input
            type="checkbox"
            checked={explain}
            onChange={(event) => {
              setExplain(event.target.checked);
              setWord(null);
            }}
          />
          <span className="switch-label">詞彙解說</span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-knob" />
          </span>
        </label>
      </div>

      {article.dictionaryReady && explain ? (
        <div className="level-control">
          <span className="level-label">難易度</span>
          <span className="level-end">初級</span>
          <input
            type="range"
            min={1}
            max={MAX_BAND}
            step={1}
            value={level}
            onChange={(event) => setLevel(Number(event.target.value))}
            aria-label="難易度：往右代表已知的詞越多，標記越少"
          />
          <span className="level-end">進階</span>
          <span className="level-count">已標記 {markedCount} 個詞</span>
        </div>
      ) : null}

      <div
        className="reader"
        ref={rootRef}
        onPointerUp={onReaderPointerUp}
        // A double click would otherwise also select the word under it, leaving
        // a highlight that has nothing to do with the card that just opened.
        onMouseDown={(event) => {
          if (event.detail > 1) event.preventDefault();
        }}
      >
        {paragraphs.map((group) => (
          <p className="para" key={group[0]!.id}>
            {group.map((sentence) => (
              <Sentence
                key={sentence.id}
                sentence={sentence}
                marked={marked}
                selectedId={word?.token.id ?? null}
                asking={sentence.id === asking?.sentenceId}
                onSelect={onSelectToken}
                onHover={onHoverToken}
              />
            ))}
          </p>
        ))}
      </div>


      {asking ? (
        <AskDialog
          key={asking.sentenceId}
          target={asking}
          onClose={() => setAsking(null)}
        />
      ) : word ? (
        <WordCard
          token={word.token}
          senses={
            word.token.entryId ? (article.senses[word.token.entryId] ?? []) : []
          }
          learning={learning.has(groupKey(word.token))}
          onToggleLearning={() => onToggleLearning(word.token)}
          rect={word.rect}
          onClose={() => setWord(null)}
          onPointerEnter={hold}
          onPointerLeave={() => {
            closeTimer.current = setTimeout(() => setWord(null), HOVER_GRACE_MS);
          }}
        />
      ) : null}
    </>
  );
}

function Sentence({
  sentence,
  marked,
  selectedId,
  asking,
  onSelect,
  onHover,
}: {
  sentence: ArticleSentence;
  marked: (token: ArticleToken) => boolean;
  selectedId: string | null;
  /** The Q&A card is open on this sentence. */
  asking: boolean;
  onSelect: (token: ArticleToken, element: HTMLElement) => void;
  onHover: (token: ArticleToken | null, element: HTMLElement) => void;
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
        marked={marked(token)}
        selected={token.id === selectedId}
        onSelect={onSelect}
        onHover={onHover}
      />,
    );
    cursor = token.charEnd;
  }

  if (cursor < sentence.text.length) {
    parts.push(<span key="gap-tail">{sentence.text.slice(cursor)}</span>);
  }

  return (
    <span
      // Anchor target for Dictionary occurrence links.
      id={`sentence-${sentence.id}`}
      className={[
        'sentence',
        sentence.needsReview ? 'review' : '',
        asking ? 'asking' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-sentence-id={sentence.id}
    >
      {parts}
    </span>
  );
}
