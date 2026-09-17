import { notFound, redirect } from 'next/navigation';
import { Chapters } from '../../../components/Chapters.tsx';
import { Reader } from '../../../components/Reader.tsx';
import { isReadable } from '../../../lib/analysis/drain.ts';
import { getArticle } from '../../../lib/article.ts';

export const dynamic = 'force-dynamic';

export default async function ReadPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;

  // Homograph resolution moves `lexeme.dictEntryId`, and the Dictionary groups
  // on it -- so an article read mid-resolution would file a word under one entry
  // and then another. The Library is where the progress is, so send them back to
  // it rather than rendering a half-settled page.
  if (!isReadable(sectionId)) redirect('/library');

  const article = getArticle(sectionId);
  if (!article) notFound();

  // A chapter split into parts is only their heading, with no text to read.
  // Nothing links to it, but a URL saved before the split would land on an
  // empty page -- open its first part instead.
  const firstPart = article.chapters.find((chapter) => chapter.parentId === sectionId);
  if (firstPart) redirect(`/read/${firstPart.sectionId}`);

  // A book puts the work's name above the chapter's; an article has only the
  // one name and repeating it would read as a mistake.
  const isBook = article.chapters.length > 1;

  return (
    <main>
      {isBook ? (
        <p className="work" lang="ja">
          {article.workTitle}
        </p>
      ) : null}
      <h1 lang="ja">{article.sectionTitle ?? article.workTitle}</h1>
      <p className="subtitle">
        {article.sentences.length} 個句子 · {article.vocabCount} 個詞
        {article.author ? ` · ${article.author}` : ''}
      </p>
      {isBook ? (
        <Chapters chapters={article.chapters} current={article.sectionId} />
      ) : null}
      <Reader article={article} />
      {isBook ? (
        <Chapters
          chapters={article.chapters}
          current={article.sectionId}
          placement="foot"
        />
      ) : null}
    </main>
  );
}
