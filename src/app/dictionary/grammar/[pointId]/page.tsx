import { notFound } from 'next/navigation';
import { TsutsujiNotice } from '../../../../components/TsutsujiNotice.tsx';
import { examplesOf, isKept, keptPoints } from '../../../../lib/grammar/library.ts';
import { loadGrammar } from '../../../../lib/grammar/load.ts';
import { releaseGrammarFromDictionary } from '../../actions.ts';

export const dynamic = 'force-dynamic';

/**
 * One grammar point: what it means, the points it is easily confused with, and
 * every sentence you kept it from.
 *
 * Laid out like a word's entry page on purpose -- meaning, then where it was
 * met, each sentence a link back into its chapter -- so the two halves of the
 * Dictionary read the same way.
 */
export default async function GrammarPointPage({
  params,
}: {
  params: Promise<{ pointId: string }>;
}) {
  const { pointId } = await params;
  const grammar = loadGrammar();
  const point = grammar.point(pointId);
  const kept = isKept(pointId);
  // A kept point whose row a later つつじ dropped still has a page: something
  // you chose to learn does not vanish because the data moved.
  if (!point && !kept) notFound();

  const examples = examplesOf(pointId);
  const keptIds = new Set(keptPoints().map((p) => p.pointId));
  const peers = grammar.peers(pointId);

  return (
    <main>
      <p className="back">
        <a href="/dictionary?grammar=1">← 文法</a>
      </p>

      <h1 className="entry-head" lang="ja">
        ～{point?.base ?? pointId}
      </h1>
      <p className="subtitle">
        {point ? (
          <>
            難度 {point.difficulty}
            <span className="grammar-class" lang="ja">
              {' · '}
              {point.meaningName}
            </span>
          </>
        ) : (
          '這個句型已不在目前的つつじ中'
        )}
      </p>

      <h2 className="section-label">意思</h2>
      {point?.nameZh ? (
        <ol className="senses">
          <li>
            <span className="gloss-zh">{point.nameZh}</span>
            <span className="gloss-en sole">{point.glossZh}</span>
          </li>
        </ol>
      ) : (
        <p className="empty">還沒有中文說明。</p>
      )}

      {/*
        The 意味的等価クラス: expressions that paraphrase this one. Related and
        never merged -- they are what a reader has to tell apart, which is why
        they sit on the page rather than being folded into it.
      */}
      {peers.length > 0 ? (
        <>
          <h2 className="section-label">相似句型</h2>
          <ul className="grammar-peers">
            {peers.map((peer) => (
              <li key={peer.id}>
                <a href={`/dictionary/grammar/${peer.id}`}>
                  <span lang="ja">～{peer.base}</span>
                  <span className="grammar-peer-gloss">{peer.glossZh ?? peer.nameZh}</span>
                  {keptIds.has(peer.id) ? (
                    <span className="grammar-peer-kept">已在文法庫</span>
                  ) : null}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <h2 className="section-label">{`${examples.length} 個例句`}</h2>
      {examples.length === 0 ? (
        <p className="empty">
          {kept
            ? '例句所在的文章已刪除。句型還留在文法庫裡。'
            : '這個句型還沒有加入文法庫。在句子上雙擊，就能從卡片上加入。'}
        </p>
      ) : (
        <ul className="occurrences">
          {examples.map((example) => (
            <li key={example.sentenceId}>
              <a href={`/read/${example.sectionId}#sentence-${example.sentenceId}`}>
                <span className="where" lang="ja">
                  {example.workTitle}
                  {example.sectionTitle ? ` · ${example.sectionTitle}` : ''}
                  {example.stale ? <span lang="zh-Hant-TW"> · 句子已修改</span> : null}
                </span>
                {/*
                  An edited sentence shows without its mark: the offsets were
                  taken before the edit, and a wrong mark is worse than none.
                */}
                <span className="quote" lang="ja">
                  {example.stale ? (
                    example.text
                  ) : (
                    <>
                      {example.text.slice(0, example.charStart)}
                      <mark>{example.text.slice(example.charStart, example.charEnd)}</mark>
                      {example.text.slice(example.charEnd)}
                    </>
                  )}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}

      {kept ? (
        <form action={releaseGrammarFromDictionary} className="grammar-release">
          <input type="hidden" name="pointId" value={pointId} />
          <button type="submit" className="link">
            移出文法庫
          </button>
        </form>
      ) : null}

      <TsutsujiNotice />
    </main>
  );
}
