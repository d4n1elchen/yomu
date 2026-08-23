import { listLibrary } from '../../lib/library.ts';
import { toHiragana } from '../../lib/text/kana.ts';

export const dynamic = 'force-dynamic';

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; q?: string }>;
}) {
  const { pos, q } = await searchParams;
  const { entries, total, facets } = listLibrary({ pos, q });

  const href = (next: { pos?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (next.pos) params.set('pos', next.pos);
    if (next.q) params.set('q', next.q);
    const query = params.toString();
    return query ? `/library?${query}` : '/library';
  };

  return (
    <main>
      <h1>Library</h1>
      <p className="subtitle">
        {total} {total === 1 ? 'entry' : 'entries'}
        {entries.length < total ? ` · showing ${entries.length}` : ''}
      </p>

      <form action="/library" className="filter-form">
        {pos ? <input type="hidden" name="pos" value={pos} /> : null}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="辞書形 or 読み で検索"
        />
        <button type="submit">Search</button>
      </form>

      <nav className="facets">
        <a className={pos ? '' : 'active'} href={href({ q })}>
          content words
        </a>
        {facets.map((facet) => (
          <a
            key={facet.pos}
            className={pos === facet.pos ? 'active' : ''}
            href={href({ pos: facet.pos, q })}
          >
            {facet.pos} <span className="count">{facet.count}</span>
          </a>
        ))}
      </nav>

      {entries.length === 0 ? (
        <p className="empty">
          No entries yet. Import a lesson and the words will collect here.
        </p>
      ) : (
        <ul className="entries">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a href={`/library/${entry.id}`}>
                <span className="lemma">
                  {entry.lemma}
                  {entry.reading ? (
                    <span className="reading">
                      {toHiragana(entry.reading)}
                    </span>
                  ) : null}
                </span>
                <span className="entry-meta">
                  {entry.pos}
                  {entry.forms.length > 1
                    ? ` · ${entry.forms.join('・')}`
                    : ''}
                </span>
                <span className="tally">{entry.occurrences}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <p className="back">
        <a href="/">← lessons</a>
      </p>
    </main>
  );
}
