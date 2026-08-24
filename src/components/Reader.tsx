'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Article, ArticleSentence, ArticleToken } from '../lib/article.ts';
import { DEFAULT_LEVEL, MAX_BAND, isHardWord } from '../lib/marking.ts';
import { selectionSpans, type TouchedToken } from '../lib/qa/selection.ts';
import { AskDialog, type ReaderSelection } from './AskDialog.tsx';
import { ReadStamp } from './ReadStamp.tsx';
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

function readToken(element: Element): TouchedToken | null {
  const sentenceId = element.getAttribute('data-sentence');
  const start = element.getAttribute('data-start');
  const end = element.getAttribute('data-end');
  if (sentenceId === null || start === null || end === null) return null;
  return { sentenceId, charStart: Number(start), charEnd: Number(end) };
}

function closestToken(node: Node | null): Element | null {
  const element =
    node === null
      ? null
      : node.nodeType === Node.ELEMENT_NODE
        ? (node as Element)
        : node.parentElement;
  return element?.closest('[data-token]') ?? null;
}

/**
 * The tokens a range touches, in document order.
 *
 * Cloning the range is what makes this cheap: a partially selected element is
 * cloned with its attributes, so the fragment holds exactly the tokens with at
 * least one selected character and nothing else in the article is examined.
 *
 * The exception is a selection living entirely inside one token -- dragging
 * across 読み inside 読み終わる. There the token element is the range's common
 * ancestor rather than its content, so the fragment comes back with no token in
 * it and the enclosing one has to be found by walking up.
 */
function touchedTokens(range: Range): TouchedToken[] {
  const found: TouchedToken[] = [];
  for (const element of range.cloneContents().querySelectorAll('[data-token]')) {
    const token = readToken(element);
    if (token) found.push(token);
  }
  if (found.length > 0) return found;

  const enclosing =
    closestToken(range.startContainer) ?? closestToken(range.endContainer);
  const token = enclosing ? readToken(enclosing) : null;
  return token ? [token] : [];
}

export function Reader({ article }: { article: Article }) {
  const [explain, setExplain] = useState(true);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
  const [word, setWord] = useState<OpenWord | null>(null);
  const [selection, setSelection] = useState<ReaderSelection | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const marked = useCallback(
    (token: ArticleToken) => explain && isHardWord(token, level),
    [explain, level],
  );

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

  const textOf = useCallback(
    (sentenceId: string, charStart: number, charEnd: number) =>
      article.sentences
        .find((s) => s.id === sentenceId)
        ?.text.slice(charStart, charEnd) ?? '',
    [article.sentences],
  );

  const settle = useCallback(() => {
    const root = rootRef.current;
    const current = window.getSelection();
    if (!root || !current || current.rangeCount === 0) return;

    const range = current.getRangeAt(0);
    // A selection outside the article -- clicking into the card's composer, for
    // one -- says nothing about what is selected in the text, so it is ignored
    // rather than treated as a dismissal.
    if (!root.contains(range.commonAncestorContainer)) return;

    if (current.isCollapsed) {
      setSelection(null);
      return;
    }

    const spans = selectionSpans(touchedTokens(range));
    if (spans.length === 0) {
      setSelection(null);
      return;
    }

    // Where the selection is, in viewport coordinates. Deciding where the card
    // fits around it needs the card's own size, so that is left to the card.
    const rect = range.getBoundingClientRect();

    setSelection({
      spans,
      text: spans
        .map((span) => textOf(span.sentenceId, span.charStart, span.charEnd))
        .join(''),
      rect: { top: rect.top, bottom: rect.bottom, left: rect.left },
    });
    // A selection and a word card are two answers to the same gesture; the
    // selection wins.
    setWord(null);
  }, [textOf]);

  useEffect(() => {
    const onSelectionChange = () => {
      // Mid-drag the selection is still growing; wait for the release.
      if (!dragging.current) settle();
    };
    const onPointerDown = () => {
      dragging.current = true;
    };
    const onPointerUp = () => {
      dragging.current = false;
      settle();
    };

    document.addEventListener('selectionchange', onSelectionChange);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', onPointerUp);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', onPointerUp);
    };
  }, [settle]);

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
    // A selection and a word card are two answers to the same gesture, and the
    // selection wins -- the same rule tapping already follows. Mid-drag the
    // pointer also sweeps over words on its way to the end of the selection,
    // and none of those crossings is a request to explain anything.
    if (selection || dragging.current) return;
    hold();
    setWord({ token, rect: anchorOf(element) });
  };

  return (
    <>
      <ReadStamp sectionId={article.sectionId} />

      <div className="reader-controls">
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

      <div className="reader" ref={rootRef}>
        {article.sentences.map((sentence) => (
          <Sentence
            key={sentence.id}
            sentence={sentence}
            marked={marked}
            selectedId={word?.token.id ?? null}
            onSelect={onSelectToken}
            onHover={onHoverToken}
          />
        ))}
      </div>

      <p className="reader-hint">
        虛線是超出目前難易度的詞 — 滑過去或點一下看說明。選取任一段文字即可提問；關掉「詞彙解說」則只讀原文。
      </p>

      {selection ? (
        <AskDialog
          key={selection.spans
            .map((s) => `${s.sentenceId}:${s.charStart}-${s.charEnd}`)
            .join(',')}
          selection={selection}
          onClose={() => setSelection(null)}
        />
      ) : word ? (
        <WordCard
          token={word.token}
          senses={
            word.token.entryId ? (article.senses[word.token.entryId] ?? []) : []
          }
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
  onSelect,
  onHover,
}: {
  sentence: ArticleSentence;
  marked: (token: ArticleToken) => boolean;
  selectedId: string | null;
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
      className={sentence.needsReview ? 'sentence review' : 'sentence'}
      data-sentence-id={sentence.id}
    >
      {parts}
    </span>
  );
}
