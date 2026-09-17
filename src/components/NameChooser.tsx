'use client';

import { useState } from 'react';
import type { ArticleSentence, ArticleToken } from '../lib/article.ts';

/** How far either side of the tapped word a name may reach, in tokens. */
const REACH = 3;

/** Marks and particles end the row: a name does not run through them. */
const usable = (token: ArticleToken) =>
  token.pos !== '記号' && token.pos !== '助詞' && token.pos !== '助動詞';

/**
 * Picks out a name the analyzer split, starting from the piece you tapped.
 *
 * The neighbouring tokens are chips; tapping one to the left or right extends
 * the name to it, and tapping the outermost chosen chip again pulls the name
 * back in by one. The tapped piece is always part of it -- it is the piece you
 * opened the card on -- and the name is previewed exactly as it will be looked
 * for in the text.
 */
export function NameChooser({
  sentence,
  token,
  onConfirm,
  onCancel,
}: {
  sentence: ArticleSentence;
  token: ArticleToken;
  /** Resolves to an error to show, or null once the name has been applied. */
  onConfirm: (surface: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const tokens = sentence.tokens;
  const at = Math.max(0, tokens.findIndex((t) => t.id === token.id));

  let from = at;
  while (from > 0 && at - from < REACH && usable(tokens[from - 1]!)) from--;
  let to = at;
  while (to < tokens.length - 1 && to - at < REACH && usable(tokens[to + 1]!)) to++;

  const [range, setRange] = useState<[number, number]>([at, at]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const surface = sentence.text.slice(tokens[range[0]]!.charStart, tokens[range[1]]!.charEnd);

  const tap = (index: number) => {
    const [lo, hi] = range;
    if (index < at) setRange([index === lo ? lo + 1 : index, hi]);
    else if (index > at) setRange([lo, index === hi ? hi - 1 : index]);
  };

  const confirm = async () => {
    setPending(true);
    setError(null);
    const problem = await onConfirm(surface).catch(() => '連不上伺服器，無法標為人名。');
    // On success the reader reloads the chapter underneath and this card closes
    // with it; only a refusal leaves anything to show.
    if (problem) {
      setError(problem);
      setPending(false);
    }
  };

  return (
    <div className="name-chooser">
      <p className="name-hint">點選前後的字，把整個名字選進來：</p>
      <div className="name-chips" lang="ja">
        {tokens.slice(from, to + 1).map((t, offset) => {
          const index = from + offset;
          const on = index >= range[0] && index <= range[1];
          return (
            <button
              key={t.id}
              type="button"
              className={on ? 'name-chip on' : 'name-chip'}
              aria-pressed={on}
              disabled={pending || index === at}
              onClick={() => tap(index)}
            >
              {t.surface}
            </button>
          );
        })}
      </div>
      <p className="name-preview">
        人名<span lang="ja">{surface}</span>
      </p>
      <p className="name-note">
        這部作品裡的「<span lang="ja">{surface}</span>」都會當成同一個名字，不再算作詞彙。可以在辭典的「人名」取消。
      </p>
      {error ? <p className="name-error">{error}</p> : null}
      <div className="name-buttons">
        <button type="button" onClick={onCancel} disabled={pending}>
          取消
        </button>
        <button type="button" className="primary" onClick={confirm} disabled={pending}>
          {pending ? '套用中…' : '確定'}
        </button>
      </div>
    </div>
  );
}
