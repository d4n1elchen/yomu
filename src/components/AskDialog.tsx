'use client';

import { useEffect, useRef, useState } from 'react';
import type { LlmMessage } from '../lib/llm/index.ts';
import { GrammarBubble, useSentenceGrammar } from './GrammarBubble.tsx';
import { Markdown } from './Markdown.tsx';
import { anchorStyle, useCardAnchor, type AnchorRect } from './useCardAnchor.ts';

export interface AskTarget {
  sentenceId: string;
  /** The sentence's text, as shown at the top of the card. */
  text: string;
  /** The sentence's box in viewport coordinates. */
  rect: AnchorRect;
}

const CHIPS = ['說明文法', '為何是這個形式？', '語感差異'];

/**
 * A chat, not an answer. The card opens on a templated greeting so it appears
 * the instant you double-tap the sentence, rather than after a generation --
 * and from there it is a conversation, so a follow-up does not mean starting
 * over with a differently worded question.
 *
 * Nothing here is stored. The greeting is regenerated next time you open the same
 * sentence, and closing the card discards the thread.
 */
export function AskDialog({
  target,
  onClose,
}: {
  target: AskTarget;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<LlmMessage[]>([]);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const abort = useRef<AbortController | null>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const cardRef = useCardAnchor<HTMLDivElement>(target.rect);
  // Starts with the card, not with the first question: see `useSentenceGrammar`.
  const grammar = useSentenceGrammar(target.sentenceId);
  // 這不是這個句型 dismisses a row for as long as the card is open. It stores
  // nothing: remembering a rejection would be the first judgement Q&A ever
  // kept, and the rule that it keeps nothing is worth more than a re-read's tap.
  // Held here rather than in the bubble so a question leaves it out too.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const analysing = grammar.status === 'loading';
  const shownPoints =
    grammar.status === 'ready'
      ? grammar.reply.points.filter((point) => !dismissed.has(point.pointId))
      : [];

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the newest bubble in view as the answer grows. Not when the grammar
  // arrives: it is the first message, and scrolling to the greeting under it
  // would push the top of a long list out of sight.
  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [turns, streaming]);

  const pending = streaming !== null;

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending || analysing) return;

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
        // Ids and surfaces only; the server fills in the names and glosses.
        body: JSON.stringify({
          sentenceId: target.sentenceId,
          turns: next,
          grammar: shownPoints.map(({ pointId, surface }) => ({ pointId, surface })),
        }),
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
  // Only once there is something above to scroll back to: before the first
  // question the bubble is still in view.
  const backToGrammar = shownPoints.length > 0 && turns.length > 0;

  return (
    <div
      className="ask-card"
      role="dialog"
      aria-label="關於這一句的問答"
      ref={cardRef}
      style={anchorStyle(target.rect)}
    >
      <div className="ask-head">
        <div className="ask-sentence">
          <span className="ask-label">這一句</span>
          <p>{target.text}</p>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="關閉">
          ×
        </button>
      </div>

      <div className="ask-thread" ref={threadRef}>
        {/*
          The grammar comes first and the conversation waits for it. A question
          sent mid-analysis queues behind it on the one model anyway, and an
          answer that starts after it can be told which points the card shows,
          so the two explain the same grammar under the same names.
        */}
        <GrammarBubble
          state={grammar}
          sentence={target.text}
          sentenceId={target.sentenceId}
          dismissed={dismissed}
          onDismiss={(pointId) => setDismissed((all) => new Set(all).add(pointId))}
        />
        {!analysing ? (
          <p className="bubble assistant">
            想知道這一句的什麼呢？可以直接問，或從下面選一個。
          </p>
        ) : null}
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

      {(chips.length > 0 || backToGrammar) && !pending && !analysing ? (
        <div className="ask-chips">
          {/*
            The bubble scrolls away once the conversation starts, and adding a
            point is exactly what you want after a few follow-ups. This brings
            it back rather than pinning it: the panel is too short on a phone to
            spend a strip on every sentence. The grammar is the first message,
            so back to it is the top of the thread -- a jump, not a smooth
            scroll, which a background tab never animates.
          */}
          {backToGrammar ? (
            <button
              type="button"
              className="back-to-grammar"
              onClick={() => threadRef.current?.scrollTo({ top: 0 })}
            >
              ↑ 文法 <b>{shownPoints.length}</b>
            </button>
          ) : null}
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
          placeholder={analysing ? '正在找句型，請稍候…' : '輸入問題…'}
          aria-label="輸入問題"
          disabled={analysing}
        />
        <button
          type="submit"
          disabled={pending || analysing || !draft.trim()}
          aria-label="送出"
        >
          →
        </button>
      </form>

      {/*
        No longer "nothing is stored": a grammar card can be added. The
        conversation itself still goes when the card closes, and the note says
        which is which rather than letting the old promise quietly lapse.
      */}
      <p className="ask-note">問答不會儲存；加入的句型會留在文法庫</p>
    </div>
  );
}
