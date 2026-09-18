'use client';

import { useEffect, useState } from 'react';
import { keepGrammar, releaseGrammar } from '../app/read/actions.ts';

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
  /** Already in the 文法庫. */
  kept: boolean;
  /** How many sentences are kept for it, this one included. */
  examples: number;
  /** This sentence is already one of them. */
  thisSentence: boolean;
}

export interface GrammarReply {
  /** The sentence revision the spans were found against -- the anchor. */
  revision: number;
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
 */
export function GrammarBubble({
  state,
  sentence,
  sentenceId,
  dismissed,
  onDismiss,
}: {
  state: State;
  sentence: string;
  sentenceId: string;
  /** Held by the dialog, which leaves these out of what a question sends. */
  dismissed: ReadonlySet<string>;
  onDismiss: (pointId: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Local overrides on top of what the server said: an add or a removal shows
  // at once, the way marking a 生詞 does, rather than after a round trip.
  const [overrides, setOverrides] = useState<Record<string, Partial<GrammarCard>>>({});
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <p className="bubble assistant grammar-bubble">
        <span className="thinking">正在分析這一句的句型…</span>
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

  const { others, revision } = state.reply;
  const points = state.reply.points
    .filter((point) => !dismissed.has(point.pointId))
    .map((point) => ({ ...point, ...overrides[point.pointId] }));

  if (points.length === 0 && others.length === 0) {
    return (
      <p className="bubble assistant grammar-bubble">
        <span className="grammar-quiet">這一句沒有可收錄的句型。</span>
      </p>
    );
  }

  const keep = async (point: GrammarCard) => {
    setError(null);
    const before = overrides[point.pointId];
    setOverrides((all) => ({
      ...all,
      [point.pointId]: {
        kept: true,
        thisSentence: true,
        examples: point.thisSentence ? point.examples : point.examples + 1,
      },
    }));
    const { error: problem } = await keepGrammar({
      pointId: point.pointId,
      sentenceId,
      sentenceRevision: revision,
      charStart: point.charStart,
      charEnd: point.charEnd,
      surface: point.surface,
    }).catch(() => ({ error: '連不上伺服器，無法加入文法庫。' }));
    if (problem) {
      setOverrides((all) => ({ ...all, [point.pointId]: before ?? {} }));
      setError(problem);
    }
  };

  const release = async (point: GrammarCard) => {
    setError(null);
    setOverrides((all) => ({
      ...all,
      [point.pointId]: { kept: false, thisSentence: false, examples: 0 },
    }));
    await releaseGrammar(point.pointId).catch(() =>
      setError('連不上伺服器，無法移出文法庫。'),
    );
  };

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
                  <div className="grammar-line">
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
                    </button>
                    {/*
                      The one action the row offers without opening it. What it
                      does depends on the library: a point not yet kept is
                      added; a kept one shows so, and opening the row is where
                      its example is added.
                    */}
                    {point.kept ? (
                      <span className="grammar-add on" aria-label="已在文法庫">
                        ✓ 已在
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="grammar-add"
                        onClick={() => void keep(point)}
                      >
                        ＋ 加入
                      </button>
                    )}
                  </div>

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
                        {point.kept ? <span>文法庫裡有 {point.examples} 個例句</span> : null}
                      </p>
                      <div className="grammar-actions">
                        {!point.kept ? (
                          <button
                            type="button"
                            className="grammar-primary"
                            onClick={() => void keep(point)}
                          >
                            ＋ 加入文法庫
                          </button>
                        ) : point.thisSentence ? (
                          <span className="grammar-done">✓ 這個例句已加入</span>
                        ) : (
                          <button
                            type="button"
                            className="grammar-primary"
                            onClick={() => void keep(point)}
                          >
                            ＋ 加入這個例句
                          </button>
                        )}
                        {point.kept ? (
                          <button
                            type="button"
                            className="grammar-secondary"
                            onClick={() => void release(point)}
                          >
                            移出文法庫
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="grammar-secondary"
                            onClick={() => {
                              onDismiss(point.pointId);
                              setOpen(null);
                            }}
                          >
                            這不是這個句型
                          </button>
                        )}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        // Said rather than left blank: an empty space above 其他句型 reads as
        // a list that failed to load.
        <p className="grammar-quiet">這一句沒有可收錄的句型。</p>
      )}

      {error ? <p className="grammar-error">{error}</p> : null}

      {/*
        Grammar the model saw that the inventory has no point for. Explained,
        never addable: an addable one would be an entry the model named, which
        is the design that produced near-duplicates and was removed.
      */}
      {others.length > 0 ? (
        <div className="grammar-others">
          <p className="grammar-lead">其他句型</p>
          {/*
            Laid out like the rows above so they read as the same kind of
            thing, but with nothing to open and nothing to press: 未收錄 sits
            where ＋ 加入 would be.
          */}
          <ul className="grammar-list">
            {others.map((other) => (
              <li key={`${other.form}-${other.name}`}>
                <div className="grammar-line">
                  <span className="grammar-row static">
                    <span className="grammar-form" lang="ja">
                      {other.form}
                    </span>
                    <span className="grammar-name">{other.name}</span>
                  </span>
                  <span className="grammar-add on">未收錄</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
