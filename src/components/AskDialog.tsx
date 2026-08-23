'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { LlmMessage } from '../lib/llm/index.ts';
import type { SelectionSpan } from '../lib/qa/selection.ts';

export interface ReaderSelection {
  spans: SelectionSpan[];
  /** The selected text, snapped out to whole tokens. */
  text: string;
  /** The selection's box in viewport coordinates. */
  rect: { top: number; bottom: number; left: number };
}

const CHIPS = ['說明文法', '為何是這個形式？', '語感差異'];

/** Breathing room between the card and both the selection and the viewport. */
const GAP = 12;

/**
 * A chat, not an answer. The card opens on a templated greeting so it appears
 * the instant you let go of the selection, rather than after a generation --
 * and from there it is a conversation, so a follow-up does not mean starting
 * over with a differently worded question.
 *
 * Nothing here is stored. The greeting is regenerated next time you select the
 * same text, and closing the card discards the thread.
 */
export function AskDialog({
  selection,
  onClose,
}: {
  selection: ReaderSelection;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<LlmMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const abort = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abort.current?.abort(), []);

  /**
   * Hang the card off the selection without letting it run off screen.
   *
   * Measuring the rendered card rather than assuming its size is what keeps the
   * size a pure CSS decision -- widening the desktop card must not mean
   * remembering to change a number in here too. `useLayoutEffect` runs before
   * paint, so the corrected position is the first one drawn.
   *
   * The card also has to be capped to the room on the side it was placed. It
   * opens holding only the greeting and grows as the conversation does, so
   * positioning it once against its opening height would let a card near the
   * bottom of the window grow straight off the screen.
   *
   * The mobile sheet is positioned entirely by CSS, which reads none of these
   * custom properties, so writing them there is harmless.
   */
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;

    const { top, bottom, left } = selection.rect;
    const spaceBelow = window.innerHeight - bottom - GAP * 2;
    const spaceAbove = top - GAP * 2;
    const below = spaceBelow >= spaceAbove;

    card.style.setProperty(
      '--ask-room',
      `${Math.max(0, below ? spaceBelow : spaceAbove)}px`,
    );

    // Read after writing the cap, so this is the height that will be painted
    // rather than the uncapped one.
    const { width, height } = card.getBoundingClientRect();

    const x = Math.min(
      Math.max(GAP, left),
      Math.max(GAP, window.innerWidth - width - GAP),
    );
    const y = below
      ? bottom + GAP
      : Math.max(GAP, top - GAP - height);

    card.style.setProperty('--ask-x', `${x}px`);
    card.style.setProperty('--ask-y', `${y}px`);
  }, [selection.rect]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the newest bubble in view as the answer grows.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [turns, streaming]);

  const pending = streaming !== null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;

    const next: LlmMessage[] = [...turns, { role: 'user', content: question }];
    setTurns(next);
    setDraft('');
    setError(null);
    setStreaming('');

    const controller = new AbortController();
    abort.current = controller;

    let answer = '';
    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ spans: selection.spans, turns: next }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setError(await response.text());
        setStreaming(null);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += decoder.decode(value, { stream: true });
        setStreaming(answer);
      }
      setTurns([...next, { role: 'assistant', content: answer }]);
      setStreaming(null);
    } catch (cause) {
      if ((cause as Error).name === 'AbortError') return;
      setError((cause as Error).message);
      setStreaming(null);
    }
  }

  const asked = new Set(
    turns.filter((t) => t.role === 'user').map((t) => t.content),
  );
  const chips = CHIPS.filter((chip) => !asked.has(chip));

  return (
    <div
      className="ask-card"
      role="dialog"
      aria-label="關於選取內容的問答"
      ref={cardRef}
      // A first guess that needs no knowledge of the card's size; the layout
      // effect above corrects it once there is something to measure.
      style={
        {
          '--ask-x': `${selection.rect.left}px`,
          '--ask-y': `${selection.rect.bottom + GAP}px`,
        } as React.CSSProperties
      }
    >
      <div className="ask-head">
        <div className="ask-selection">
          <span className="ask-label">選取的部分</span>
          <p>{selection.text}</p>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

      <div className="ask-thread" ref={threadRef}>
        <p className="bubble assistant">
          「{selection.text}」{'\n'}
          想知道這個部分的什麼呢？可以直接問，或從下面選一個。
        </p>
        {turns.map((turn, i) => (
          <p key={i} className={`bubble ${turn.role}`}>
            {turn.content}
          </p>
        ))}
        {streaming !== null ? (
          <p className="bubble assistant">
            {streaming || <span className="thinking">思考中…</span>}
          </p>
        ) : null}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {chips.length > 0 && !pending ? (
        <div className="ask-chips">
          {chips.map((chip) => (
            <button key={chip} type="button" onClick={() => void send(chip)}>
              {chip}
            </button>
          ))}
        </div>
      ) : null}

      <form
        className="ask-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="輸入問題…"
          aria-label="輸入問題"
        />
        <button type="submit" disabled={pending || !draft.trim()} aria-label="送出">
          →
        </button>
      </form>

      <p className="ask-note">不會儲存 — 關閉後即消失</p>
    </div>
  );
}
