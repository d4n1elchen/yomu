import { notFound } from 'next/navigation';
import { EdrdgNotice } from '../../../components/EdrdgNotice.tsx';
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

  const { entry, occurrences, forms, meaning } = detail;

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
        {meaning?.band != null ? (
          <span className="band" title="JMdict 詞頻分級，數字越小越常見">
            {`nf${String(meaning.band).padStart(2, '0')}`}
          </span>
        ) : meaning?.common ? (
          // JMdict flags it common but the newspaper corpus never ranked it,
          // so there is no band to print -- and it is not a rare word either.
          <span className="band" title="JMdict 標為常用詞，但語料庫沒有給出排名">
            常用
          </span>
        ) : null}
        {forms.length > 1 ? (
          <>
            {' · 出現形式 '}
            <span lang="ja">{forms.join('・')}</span>
          </>
        ) : null}
      </p>

      <h2 className="section-label">語義</h2>
      {meaning === null ? (
        <p className="empty">JMdict 沒有收錄這個詞。可能是名字，或是斷詞的誤判。</p>
      ) : (
        <>
          <ol className="senses">
            {meaning.senses.map((sense, index) => (
              <li key={index}>
                {sense.zh ? <span className="gloss-zh">{sense.zh}</span> : null}
                {/* Until Phase C translates it, JMdict's English is the whole
                    sense rather than a footnote under the Chinese. */}
                <span
                  className={sense.zh ? 'gloss-en' : 'gloss-en sole'}
                  lang="en"
                >
                  {sense.en}
                </span>
              </li>
            ))}
          </ol>
          {meaning.match === 'lemma' ? (
            <p className="caveat">
              這個詞只以辭書形對到 JMdict，沒有比對讀音，可能對到同形異音的另一個詞。
            </p>
          ) : meaning.match === 'lemma_reading_multi' ? (
            <p className="caveat">
              JMdict 裡有多個同形同音的詞條，這裡取最常見的一個，語義未必相符。
            </p>
          ) : null}
        </>
      )}

      <h2 className="section-label">{`${occurrences.length} 次出現`}</h2>
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

      <EdrdgNotice />
    </main>
  );
}
