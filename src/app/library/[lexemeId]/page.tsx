import { notFound } from 'next/navigation';
import { getLibraryEntry } from '../../../lib/library.ts';
import { toHiragana } from '../../../lib/text/kana.ts';

export const dynamic = 'force-dynamic';

export default async function LibraryEntryPage({
  params,
}: {
  params: Promise<{ lexemeId: string }>;
}) {
  const { lexemeId } = await params;
  const detail = getLibraryEntry(lexemeId);
  if (!detail) notFound();

  const { entry, occurrences, forms } = detail;

  return (
    <main>
      <h1 className="entry-head">
        {entry.lemma}
        {entry.reading ? (
          <span className="reading">{toHiragana(entry.reading)}</span>
        ) : null}
      </h1>
      <p className="subtitle">
        {entry.pos}
        {forms.length > 1 ? ` · forms: ${forms.join('・')}` : ''}
        {' · '}
        {occurrences.length}{' '}
        {occurrences.length === 1 ? 'occurrence' : 'occurrences'}
      </p>

      {occurrences.length === 0 ? (
        <p className="empty">
          Every occurrence of this word is in text that has not been reviewed
          yet.
        </p>
      ) : (
        <ul className="occurrences">
          {occurrences.map((occurrence) => (
            <li key={occurrence.tokenId}>
              <a
                href={`/lesson/${occurrence.sectionId}#sentence-${occurrence.sentenceId}`}
              >
                <span className="where">
                  {occurrence.workTitle}
                  {occurrence.sectionTitle ? ` · ${occurrence.sectionTitle}` : ''}
                  {occurrence.needsReview ? ' · unreviewed' : ''}
                </span>
                <span className="quote">
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

      <p className="back">
        <a href="/library">← library</a>
      </p>
    </main>
  );
}
