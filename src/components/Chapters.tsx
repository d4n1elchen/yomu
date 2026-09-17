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
 * A chapter split into numbered parts is drawn as a heading with its parts
 * beneath it. The heading is not a link -- it has no text of its own -- and the
 * neighbours and the position count only what can be opened, so 下一節 from a
 * chapter's last part walks straight into the next chapter's first.
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
  const titles = new Map(chapters.map((chapter) => [chapter.sectionId, chapter.title]));
  const headings = new Set(chapters.map((chapter) => chapter.parentId ?? null));
  const tops = chapters.filter((chapter) => !chapter.parentId);
  const leaves = chapters.filter((chapter) => !headings.has(chapter.sectionId));
  const index = leaves.findIndex((chapter) => chapter.sectionId === current);

  const topLabel = (chapter: ArticleChapter) =>
    chapter.title ?? `第 ${tops.indexOf(chapter) + 1} 章`;

  if (placement === 'foot') {
    const previous = index > 0 ? leaves[index - 1] : undefined;
    const next = index < leaves.length - 1 ? leaves[index + 1] : undefined;

    // Nothing to offer: the first chapter of a book, or one whose neighbours
    // are both still being analysed. Drawing the rule anyway left a divider
    // under the last paragraph with nothing beneath it.
    if (!previous?.readable && !next?.readable) return null;

    // Standing alone at the foot, a part needs its chapter's name: `２` says
    // nothing. And it is a 節, not a 章 -- the words say which kind of step.
    const footLabel = (chapter: ArticleChapter) =>
      chapter.parentId
        ? `${titles.get(chapter.parentId) ?? ''}（${chapter.title ?? ''}）`
        : topLabel(chapter);
    const unit = (chapter: ArticleChapter) => (chapter.parentId ? '節' : '章');

    return (
      <nav className="chapter-ends" aria-label="前後章節">
        {previous?.readable ? (
          <a className="previous" href={`/read/${previous.sectionId}`}>
            <span className="direction">← 上一{unit(previous)}</span>
            <span className="name" lang="ja">
              {footLabel(previous)}
            </span>
          </a>
        ) : (
          <span />
        )}
        {next?.readable ? (
          <a className="next" href={`/read/${next.sectionId}`}>
            <span className="direction">下一{unit(next)} →</span>
            <span className="name" lang="ja">
              {footLabel(next)}
            </span>
          </a>
        ) : null}
      </nav>
    );
  }

  const entry = (chapter: ArticleChapter, label: string) => {
    const name = (
      <span className="name" lang="ja">
        {label}
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
  };

  return (
    <details className="chapters">
      <summary>
        目次
        <span className="position">
          {index + 1} / {leaves.length}
        </span>
      </summary>
      <ol>
        {tops.map((chapter) => {
          if (!headings.has(chapter.sectionId)) return entry(chapter, topLabel(chapter));
          const parts = chapters.filter((part) => part.parentId === chapter.sectionId);
          return (
            <li key={chapter.sectionId} className="group">
              <span className="heading">
                <span className="name" lang="ja">
                  {topLabel(chapter)}
                </span>
              </span>
              <ol>
                {parts.map((part, position) =>
                  entry(part, part.title ?? String(position + 1)),
                )}
              </ol>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
