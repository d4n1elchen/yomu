'use client';

import { toHiragana } from '../lib/text/kana.ts';
import { posLabel } from '../lib/text/pos.ts';
import type { ArticleToken } from '../lib/article.ts';

/**
 * A fixed panel rather than a floating popover: the target interaction is a tap
 * on a phone, where an anchored bubble would cover the word it describes.
 *
 * Everything here comes from the analyzer. Meanings arrive with JMdict.
 */
export function WordPanel({
  token,
  onClose,
}: {
  token: ArticleToken;
  onClose: () => void;
}) {
  const reading = token.reading ? toHiragana(token.reading) : null;
  const lemmaReading = token.lemmaReading
    ? toHiragana(token.lemmaReading)
    : null;
  const inflected = token.lemma !== token.surface;

  return (
    <div className="panel" role="dialog" aria-label={`${token.surface} 的說明`}>
      <div className="panel-inner">
        <dl>
          <dt>詞</dt>
          <dd>{token.surface}</dd>

          <dt>讀音</dt>
          <dd>{reading ?? <em className="unknown">未知</em>}</dd>

          {inflected ? (
            <>
              <dt>辭書形</dt>
              <dd>
                {token.lemma}
                {lemmaReading ? (
                  <span className="lemma-reading"> {lemmaReading}</span>
                ) : null}
              </dd>
            </>
          ) : null}

          <dt>詞性</dt>
          <dd className="pos">{posLabel(token.pos)}</dd>
        </dl>
        <button
          type="button"
          className="close"
          onClick={onClose}
          aria-label="關閉"
        >
          ×
        </button>
      </div>
    </div>
  );
}
