'use client';

import { useEffect, useRef, useState } from 'react';
import type { LlmMessage } from '../lib/llm/index.ts';
import type { SelectionSpan } from '../lib/qa/selection.ts';
import { Markdown } from './Markdown.tsx';
import { anchorStyle, useCardAnchor, type AnchorRect } from './useCardAnchor.ts';

export interface ReaderSelection {
  spans: SelectionSpan[];
  /** The selected text, snapped out to whole tokens. */
  text: string;
  /** The selection's box in viewport coordinates. */
  rect: AnchorRect;
}

const CHIPS = ['說明文法', '為何是這個形式？', '語感差異'];

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
  const cardRef = useCardAnchor<HTMLDivElement>(selection.rect);

  useEffect(() => () => abort.current?.abort(), []);

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
      style={anchorStyle(selection.rect)}
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
        {/*
          The answer is rendered as Markdown, the question is not: the model was
          asked for 條列式 and emits bullets and bold, while the reader typed
          plain text and formatting their own words back at them would be a
          surprise. A div rather than a p, because a list cannot live inside a
          paragraph.
        */}
        {turns.map((turn, i) =>
          turn.role === 'assistant' ? (
            <div key={i} className="bubble assistant">
              <Markdown text={turn.content} />
            </div>
          ) : (
            <p key={i} className="bubble user">
              {turn.content}
            </p>
          ),
        )}
        {streaming !== null ? (
          <div className="bubble assistant">
            {streaming ? (
              <Markdown text={streaming} />
            ) : (
              <span className="thinking">思考中…</span>
            )}
          </div>
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
