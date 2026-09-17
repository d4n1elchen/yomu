'use client';

import { useEffect, useState } from 'react';

/** One point the sentence contains, as the card shows it. */
export interface GrammarCard {
  pointId: string;
  /** Traditional Chinese name, e.g. ～ている（正在…／狀態）. */
  name: string | null;
  gloss: string | null;
  /** The representative Japanese form, for the row's own heading. */
  base: string;
  difficulty: string;
  /** Offsets into the sentence, for marking the span in context. */
  charStart: number;
  charEnd: number;
  surface: string;
  /** Similar expressions -- から beside ので. Related, never the same card. */
  peers: string[];
}

export interface GrammarReply {
  points: GrammarCard[];
  others: { form: string; name: string }[];
}

type State =
  | { status: 'loading' }
  | { status: 'ready'; reply: GrammarReply }
  | { status: 'failed' };

/**
 * Asks what grammar is in a sentence, as soon as the card opens.
 *
 * Not when a question is sent: identification takes about 8.5 seconds, and the
 * card opens on a templated greeting, so the request runs while that greeting
 * is being read and the points are usually there before the first question.
 * Waiting for the question would put the whole delay in front of an answer
 * that has its own.
 */
export function useSentenceGrammar(sentenceId: string): State {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });

    void (async () => {
      try {
        const response = await fetch('/api/grammar', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sentenceId }),
          signal: controller.signal,
        });
        if (!response.ok) {
          setState({ status: 'failed' });
          return;
        }
        setState({ status: 'ready', reply: (await response.json()) as GrammarReply });
      } catch (cause) {
        // Aborting is this component going away, not a failure to report.
        if ((cause as Error).name === 'AbortError') return;
        setState({ status: 'failed' });
      }
    })();

    return () => controller.abort();
  }, [sentenceId]);

  return state;
}

/**
 * The cards, as a bubble in the conversation rather than a strip pinned above
 * the composer.
 *
 * The panel is compact -- a bottom sheet on a phone -- and a permanent strip
 * would spend that height on every sentence, including the one in six that has
 * no point to offer. A bubble costs height only when it has something to say,
 * and reads as what it is: the panel saying what it found in this sentence.
 *
 * Nothing here can be added yet. That is the next phase; until then this is an
 * explanation, and the panel still stores nothing at all.
 */
export function GrammarBubble({
  state,
  sentence,
}: {
  state: State;
  sentence: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <p className="bubble assistant grammar-bubble">
        <span className="thinking">正在找這一句的句型…</span>
      </p>
    );
  }

  // A failure says so rather than showing an empty list: "no grammar here" and
  // "the model did not answer" are different facts, and only one of them is
  // about the sentence.
  if (state.status === 'failed') {
    return (
      <p className="bubble assistant grammar-bubble">
        <span className="grammar-quiet">暫時找不到句型（模型沒有回應）。</span>
      </p>
    );
  }

  const { points, others } = state.reply;
  if (points.length === 0 && others.length === 0) {
    return (
      <p className="bubble assistant grammar-bubble">
        <span className="grammar-quiet">這一句沒有可收錄的句型。</span>
      </p>
    );
  }

  return (
    <div className="bubble assistant grammar-bubble">
      {points.length > 0 ? (
        <>
          <p className="grammar-lead">這一句有 {points.length} 個句型：</p>
          <ul className="grammar-list">
            {points.map((point) => {
              const expanded = open === point.pointId;
              return (
                <li key={point.pointId}>
                  <button
                    type="button"
                    className="grammar-row"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : point.pointId)}
                  >
                    <span className="grammar-form" lang="ja">
                      ～{point.base}
                    </span>
                    <span className="grammar-name">{point.gloss ?? point.name}</span>
                    <span className="grammar-caret" aria-hidden="true">
                      {expanded ? '▴' : '▾'}
                    </span>
                  </button>

                  {expanded ? (
                    <div className="grammar-open">
                      {/*
                        The span in its sentence. A matched span is often a
                        fragment -- てい of ～ていた -- and a fragment on its own
                        is not something a reader can judge.
                      */}
                      <p className="grammar-context" lang="ja">
                        {sentence.slice(0, point.charStart)}
                        <mark>{sentence.slice(point.charStart, point.charEnd)}</mark>
                        {sentence.slice(point.charEnd)}
                      </p>
                      <p className="grammar-meta">
                        <span>{point.name}</span>
                        <span>難度 {point.difficulty}</span>
                        {point.peers.length > 0 ? (
                          <span>
                            相似：
                            <span lang="ja">{point.peers.join('・')}</span>
                          </span>
                        ) : null}
                      </p>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {/*
        Grammar the model saw that the inventory has no point for. Explained,
        never addable: an addable one would be an entry the model named, which
        is the design that produced near-duplicates and was removed.
      */}
      {others.length > 0 ? (
        <p className="grammar-others">
          <span>另外說明了</span>
          {others.map((other) => (
            <span key={`${other.form}-${other.name}`} lang="ja">
              {other.name}
            </span>
          ))}
          <span>（未收錄）</span>
        </p>
      ) : null}
    </div>
  );
}
