import { after } from 'next/server';
import { AnalysisPoller } from '../../components/AnalysisPoller.tsx';
import { EdrdgNotice } from '../../components/EdrdgNotice.tsx';
import { TsutsujiNotice } from '../../components/TsutsujiNotice.tsx';
import { keptPoints } from '../../lib/grammar/library.ts';
import { ensureDraining } from '../../lib/analysis/drain.ts';
import { listDictionary } from '../../lib/dictionary.ts';
import { listNames } from '../../lib/names.ts';
import { unconfirmName } from './actions.ts';
import { learningCount } from '../../lib/vocab.ts';
import { translationProgress } from '../../lib/translate/translate.ts';
import { toHiragana } from '../../lib/text/kana.ts';
import { posLabel } from '../../lib/text/pos.ts';

export const dynamic = 'force-dynamic';

export default async function DictionaryPage({
  searchParams,
}: {
  searchParams: Promise<{
    pos?: string;
    q?: string;
    learning?: string;
    names?: string;
    grammar?: string;
  }>;
}) {
  const {
    pos,
    q,
    learning: learningParam,
    names: namesParam,
    grammar: grammarParam,
  } = await searchParams;
  const learning = learningParam === '1';
  // Names are few and never mixed with vocabulary, so the list is all of them
  // rather than another filter over the word query.
  const names = listNames();
  const showNames = namesParam === '1' && names.length > 0;
  // Grammar is listed apart from vocabulary, the way names are: the points you
  // kept, not a filter over words. Shown even when empty if asked for, so the
  // facet's link never lands on the word list instead.
  const grammar = keptPoints();
  const showGrammar = grammarParam === '1';
  const { entries, total, facets } = listDictionary({ pos, q, learning });
  const learningTotal = learningCount();

  // The gloss backlog is invisible everywhere else: translation gates nothing,
  // so a card just quietly shows English until the Chinese lands. This is the
  // page where that absence is felt, so it is where the progress belongs.
  const glosses = translationProgress();
  const translating = glosses.total > 0 && glosses.done < glosses.total;

  // Same recovery trigger as the Library. Without it this page could print a
  // figure that never moves, which is worse than not printing one.
  after(ensureDraining);

  const href = (next: { pos?: string; q?: string; learning?: boolean }) => {
    const params = new URLSearchParams();
    if (next.pos) params.set('pos', next.pos);
    if (next.q) params.set('q', next.q);
    if (next.learning) params.set('learning', '1');
    const query = params.toString();
    return query ? `/dictionary?${query}` : '/dictionary';
  };

  return (
    <main>
      <h1>辭典</h1>
      <p className="subtitle">
        {showGrammar ? (
          `文法庫共 ${grammar.length} 個句型`
        ) : (
          <>
            共 {total} 個詞
            {entries.length < total ? `，顯示前 ${entries.length} 個` : ''}
          </>
        )}
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
        <a
          className={pos || learning || showNames || showGrammar ? '' : 'active'}
          href={href({ q })}
        >
          實詞
        </a>
        {learningTotal > 0 ? (
          <a
            className={learning && !showNames ? 'active' : ''}
            href={href({ q, learning: true })}
          >
            生詞 <span className="count">{learningTotal}</span>
          </a>
        ) : null}
        {grammar.length > 0 ? (
          <a className={showGrammar ? 'active' : ''} href="/dictionary?grammar=1">
            文法 <span className="count">{grammar.length}</span>
          </a>
        ) : null}
        {names.length > 0 ? (
          <a className={showNames ? 'active' : ''} href="/dictionary?names=1">
            人名 <span className="count">{names.length}</span>
          </a>
        ) : null}
        {facets.map((facet) => (
          <a
            key={facet.pos}
            className={pos === facet.pos && !learning && !showNames ? 'active' : ''}
            href={href({ pos: facet.pos, q, learning })}
          >
            {posLabel(facet.pos)} <span className="count">{facet.count}</span>
          </a>
        ))}
      </nav>

      {showGrammar ? (
        grammar.length === 0 ? (
          <p className="empty">
            還沒有加入任何句型。閱讀時在句子上雙擊，卡片上會列出句中的句型，可以從那裡加入。
          </p>
        ) : (
          <ul className="entries grammar-entries">
            {grammar.map((point) => (
              <li key={point.pointId}>
                <a href={`/dictionary/grammar/${point.pointId}`}>
                  <span className="lemma" lang="ja">
                    ～{point.base}
                  </span>
                  {/* Level first: the gloss is a sentence and ends in 。, so
                      anything after it reads as a second sentence. */}
                  <span className="entry-meta">
                    {point.difficulty ? `${point.difficulty} · ` : ''}
                    {point.glossZh ?? point.nameZh ?? ''}
                  </span>
                  {/* Examples, where a word's row counts occurrences: grammar
                      is only recorded where you kept it. */}
                  <span className="tally">{point.examples}</span>
                </a>
              </li>
            ))}
          </ul>
        )
      ) : showNames ? (
        <ul className="entries names">
          {names.map((name) => (
            <li key={name.lexemeId}>
              <a href={`/dictionary/${name.lexemeId}`}>
                <span className="lemma" lang="ja">
                  {name.surface}
                  {name.reading ? (
                    <span className="reading">{toHiragana(name.reading)}</span>
                  ) : null}
                </span>
                <span className="entry-meta" lang="ja">
                  {name.workTitles.join('・')}
                </span>
                <span className="tally">{name.occurrences}</span>
              </a>
              <form action={unconfirmName}>
                <input type="hidden" name="lexemeId" value={name.lexemeId} />
                <button type="submit" className="link">
                  取消人名
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : entries.length === 0 ? (
        <p className="empty">
          {learning
            ? '還沒有標記生詞。閱讀時點選標記的詞，卡片上可以把它加進來。'
            : '還沒有符合的詞。'}
          {learning ? null : <a href="/new">新增一篇文章</a>}
          {learning ? null : '，詞彙就會累積到這裡。'}
        </p>
      ) : (
        <ul className="entries">
          {entries.map((entry) => (
            <li key={entry.id}>
              <a href={`/dictionary/${entry.id}`}>
                <span className="lemma" lang="ja">
                  {/* Quiet: it marks the row without competing with the word. */}
                  {entry.learning ? (
                    <span className="learn-dot" title="生詞" aria-label="生詞">
                      ★
                    </span>
                  ) : null}
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

      {showGrammar ? <TsutsujiNotice /> : <EdrdgNotice />}
    </main>
  );
}
