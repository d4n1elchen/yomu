'use client';

import { toHiragana } from '../lib/text/kana.ts';
import type { LessonToken } from '../lib/lesson.ts';

/**
 * A fixed panel rather than a floating popover: the target interaction is a tap
 * on a phone, where an anchored bubble would cover the word it describes.
 */
export function WordPanel({
  token,
  onClose,
}: {
  token: LessonToken;
  onClose: () => void;
}) {
  const reading = token.reading ? toHiragana(token.reading) : null;
  const lemmaReading = token.lemmaReading
    ? toHiragana(token.lemmaReading)
    : null;
  const inflected = token.lemma !== token.surface;

  return (
    <div className="panel" role="dialog" aria-label={`${token.surface} の情報`}>
      <div className="panel-inner">
        <dl>
          <dt>語</dt>
          <dd>{token.surface}</dd>

          <dt>読み</dt>
          <dd>{reading ?? <em style={{ color: 'var(--muted)' }}>不明</em>}</dd>

          {inflected ? (
            <>
              <dt>辞書形</dt>
              <dd>
                {token.lemma}
                {lemmaReading ? (
                  <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
                    {' '}
                    {lemmaReading}
                  </span>
                ) : null}
              </dd>
            </>
          ) : null}

          <dt>品詞</dt>
          <dd style={{ fontSize: '0.95rem' }}>{token.pos}</dd>
        </dl>
        <button type="button" className="close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
    </div>
  );
}
