import { notFound } from 'next/navigation';
import { getDictionaryEntry } from '../../../lib/dictionary.ts';
import { toHiragana } from '../../../lib/text/kana.ts';
import { posLabel } from '../../../lib/text/pos.ts';

export const dynamic = 'force-dynamic';

export default async function DictionaryEntryPage({
  params,
}: {
  params: Promise<{ lexemeId: string }>;
}) {
  const { lexemeId } = await params;
  const detail = getDictionaryEntry(lexemeId);
  if (!detail) notFound();

  const { entry, occurrences, forms } = detail;

  return (
    <main>
      <p className="back">
        <a href="/dictionary">← 辭典</a>
      </p>

      <h1 className="entry-head" lang="ja">
        {entry.lemma}
        {entry.reading ? (
          <span className="reading">{toHiragana(entry.reading)}</span>
        ) : null}
      </h1>
      <p className="subtitle">
        {posLabel(entry.pos)}
        {forms.length > 1 ? (
          <>
            {' · 出現形式 '}
            <span lang="ja">{forms.join('・')}</span>
          </>
        ) : null}
        {` · ${occurrences.length} 次出現`}
      </p>

      {occurrences.length === 0 ? (
        <p className="empty">這個詞只出現在尚未校對的文字裡。</p>
      ) : (
        <ul className="occurrences">
          {occurrences.map((occurrence) => (
            <li key={occurrence.tokenId}>
              <a
                href={`/read/${occurrence.sectionId}#sentence-${occurrence.sentenceId}`}
              >
                <span className="where" lang="ja">
                  {occurrence.workTitle}
                  {occurrence.sectionTitle ? ` · ${occurrence.sectionTitle}` : ''}
                  {occurrence.needsReview ? (
                    <span lang="zh-Hant-TW"> · 尚未校對</span>
                  ) : null}
                </span>
                <span className="quote" lang="ja">
                  {occurrence.sentenceText.slice(0, occurrence.charStart)}
                  <mark>
                    {occurrence.sentenceText.slice(
                      occurrence.charStart,
                      occurrence.charEnd,
                    )}
                  </mark>
                  {occurrence.sentenceText.slice(occurrence.charEnd)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
