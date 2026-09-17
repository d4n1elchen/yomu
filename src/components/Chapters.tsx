import type { ArticleChapter } from '../lib/article.ts';
import { DownloadChapter } from './DownloadChapter.tsx';

/**
 * Chapter navigation for a work with more than one section.
 *
 * The Library links to exactly one section per work -- where you left off, or
 * the first -- so for a book this is the only way to reach any other chapter.
 * It is drawn twice: a list at the top to jump from, and the neighbours at the
 * bottom, which is where you are when you finish one.
 *
 * A chapter whose homograph resolution has not landed is printed but not
 * linked, for the reason the Library greys a row: resolution moves
 * `lexeme.dictEntryId`, and reading across that would file a word under one
 * entry and then another. The reader would turn the URL away anyway, so
 * offering the link would only be a door that shuts in your face.
 *
 * Each readable chapter carries its own download control, so a book can be
 * taken offline chapter by chapter without opening every one of them first.
 */
export function Chapters({
  chapters,
  current,
  placement = 'head',
}: {
  chapters: ArticleChapter[];
  current: string;
  placement?: 'head' | 'foot';
}) {
  const index = chapters.findIndex((chapter) => chapter.sectionId === current);
  const label = (chapter: ArticleChapter, position: number) =>
    chapter.title ?? `第 ${position + 1} 章`;

  if (placement === 'foot') {
    const previous = index > 0 ? chapters[index - 1] : undefined;
    const next = index < chapters.length - 1 ? chapters[index + 1] : undefined;

    // Nothing to offer: the first chapter of a book, or one whose neighbours
    // are both still being analysed. Drawing the rule anyway left a divider
    // under the last paragraph with nothing beneath it.
    if (!previous?.readable && !next?.readable) return null;

    return (
      <nav className="chapter-ends" aria-label="前後章節">
        {previous?.readable ? (
          <a className="previous" href={`/read/${previous.sectionId}`}>
            <span className="direction">← 上一章</span>
            <span className="name" lang="ja">
              {label(previous, index - 1)}
            </span>
          </a>
        ) : (
          <span />
        )}
        {next?.readable ? (
          <a className="next" href={`/read/${next.sectionId}`}>
            <span className="direction">下一章 →</span>
            <span className="name" lang="ja">
              {label(next, index + 1)}
            </span>
          </a>
        ) : null}
      </nav>
    );
  }

  return (
    <details className="chapters">
      <summary>
        目次
        <span className="position">
          {index + 1} / {chapters.length}
        </span>
      </summary>
      <ol>
        {chapters.map((chapter, position) => {
          const name = (
            <span className="name" lang="ja">
              {label(chapter, position)}
            </span>
          );
          if (chapter.sectionId === current) {
            return (
              <li key={chapter.sectionId} className="current" aria-current="true">
                <span className="here">{name}</span>
                <DownloadChapter sectionId={chapter.sectionId} compact />
              </li>
            );
          }
          return (
            <li key={chapter.sectionId}>
              {chapter.readable ? (
                <>
                  <a href={`/read/${chapter.sectionId}`}>{name}</a>
                  <DownloadChapter sectionId={chapter.sectionId} compact />
                </>
              ) : (
                <span className="pending" aria-disabled="true">
                  {name}
                  <span className="analysing-label">分析中</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
