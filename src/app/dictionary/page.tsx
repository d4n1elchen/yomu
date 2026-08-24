import { after } from 'next/server';
import { AnalysisPoller } from '../../components/AnalysisPoller.tsx';
import { EdrdgNotice } from '../../components/EdrdgNotice.tsx';
import { ensureDraining } from '../../lib/analysis/drain.ts';
import { listDictionary } from '../../lib/dictionary.ts';
import { translationProgress } from '../../lib/translate/translate.ts';
import { toHiragana } from '../../lib/text/kana.ts';
import { posLabel } from '../../lib/text/pos.ts';

export const dynamic = 'force-dynamic';

export default async function DictionaryPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; q?: string }>;
}) {
  const { pos, q } = await searchParams;
  const { entries, total, facets } = listDictionary({ pos, q });

  // The gloss backlog is invisible everywhere else: translation gates nothing,
  // so a card just quietly shows English until the Chinese lands. This is the
  // page where that absence is felt, so it is where the progress belongs.
  const glosses = translationProgress();
  const translating = glosses.total > 0 && glosses.done < glosses.total;

  // Same recovery trigger as the Library. Without it this page could print a
  // figure that never moves, which is worse than not printing one.
  after(ensureDraining);

  const href = (next: { pos?: string; q?: string }) => {
    const params = new URLSearchParams();
    if (next.pos) params.set('pos', next.pos);
    if (next.q) params.set('q', next.q);
    const query = params.toString();
    return query ? `/dictionary?${query}` : '/dictionary';
  };

  return (
    <main>
      <h1>辭典</h1>
      <p className="subtitle">
        共 {total} 個詞
        {entries.length < total ? `，顯示前 ${entries.length} 個` : ''}
      </p>

      {translating ? (
        <>
          <AnalysisPoller />
          <p
            className="gloss-progress"
            role="progressbar"
            aria-valuenow={glosses.done}
            aria-valuemin={0}
            aria-valuemax={glosses.total}
            aria-label="中文語義翻譯進度"
          >
            <span>中文語義翻譯中</span>
            <span className="analysing-bar">
              <span
                className="analysing-fill"
                style={{
                  ['--progress' as string]: glosses.done / glosses.total,
                }}
              />
            </span>
            <span className="pct">
              {Math.floor((glosses.done / glosses.total) * 100)}%
            </span>
            <span>
              尚有 {glosses.total - glosses.done} 個詞條待翻譯，完成前先顯示英文。
            </span>
          </p>
        </>
      ) : null}

      <form action="/dictionary" className="filter-form">
        {pos ? <input type="hidden" name="pos" value={pos} /> : null}
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="以辭書形或讀音搜尋"
          aria-label="搜尋辭典"
        />
        <button type="submit">搜尋</button>
      </form>

      <nav className="facets">
        <a className={pos ? '' : 'active'} href={href({ q })}>
          實詞
        </a>
        {facets.map((facet) => (
          <a
            key={facet.pos}
            className={pos === facet.pos ? 'active' : ''}
            href={href({ pos: facet.pos, q })}
          >
            {posLabel(facet.pos)} <span className="count">{facet.count}</span>
          </a>
        ))}
      </nav>

      {entries.length === 0 ? (
        <p className="empty">
          還沒有符合的詞。<a href="/new">新增一篇文章</a>，詞彙就會累積到這裡。
        </p>
      ) : (
        <ul className="entries">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a href={`/dictionary/${entry.id}`}>
                <span className="lemma" lang="ja">
                  {entry.lemma}
                  {entry.reading ? (
                    <span className="reading">{toHiragana(entry.reading)}</span>
                  ) : null}
                </span>
                <span className="entry-meta">
                  {posLabel(entry.pos)}
                  {entry.forms.length > 1 ? (
                    <>
                      {' · '}
                      <span lang="ja">{entry.forms.join('・')}</span>
                    </>
                  ) : null}
                </span>
                <span className="tally">{entry.occurrences}</span>
              </a>
            </li>
          ))}
        </ul>
      )}

      <EdrdgNotice />
    </main>
  );
}
