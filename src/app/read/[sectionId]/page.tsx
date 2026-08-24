import { notFound, redirect } from 'next/navigation';
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

  return (
    <main>
      <h1 lang="ja">{article.sectionTitle ?? article.workTitle}</h1>
      <p className="subtitle">
        {article.sentences.length} 個句子 · {article.vocabCount} 個詞
        {article.author ? ` · ${article.author}` : ''}
      </p>
      <Reader article={article} />
    </main>
  );
}
