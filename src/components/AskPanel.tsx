'use client';

import { useEffect, useRef, useState } from 'react';

const SUGGESTIONS = [
  'この文の文法を説明して',
  'なぜこの形になる？',
  '語感の違いは？',
];

export function AskPanel({
  sentenceId,
  sentenceText,
  onClose,
}: {
  sentenceId: string;
  sentenceText: string;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  // Abandon an in-flight answer when the reader moves to another sentence.
  useEffect(() => {
    setQuestion('');
    setAnswer('');
    setError(null);
    return () => abort.current?.abort();
  }, [sentenceId]);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setPending(true);
    setAnswer('');
    setError(null);

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sentenceId, question: trimmed }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        setError(await response.text());
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setAnswer((prev) => prev + decoder.decode(value, { stream: true }));
      }
    } catch (cause) {
      if ((cause as Error).name !== 'AbortError') {
        setError((cause as Error).message);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="ask" role="dialog" aria-label="この文について質問">
      <div className="ask-inner">
        <div className="ask-head">
          <p className="ask-sentence">{sentenceText}</p>
          <button type="button" className="close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="この文について質問する…"
            autoFocus
          />
          <button type="submit" disabled={pending || !question.trim()}>
            {pending ? '…' : 'Ask'}
          </button>
        </form>

        {!answer && !pending ? (
          <div className="suggestions">
            {SUGGESTIONS.map((text) => (
              <button
                key={text}
                type="button"
                onClick={() => {
                  setQuestion(text);
                  void ask(text);
                }}
              >
                {text}
              </button>
            ))}
          </div>
        ) : null}

        {error ? <p className="error">{error}</p> : null}

        {answer || pending ? (
          <div className="answer">
            {answer || <span className="thinking">考えています…</span>}
          </div>
        ) : null}

      </div>
    </div>
  );
}
