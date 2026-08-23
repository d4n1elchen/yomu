import { notFound } from 'next/navigation';
import { Reader } from '../../../components/Reader.tsx';
import { getArticle } from '../../../lib/article.ts';

export const dynamic = 'force-dynamic';

export default async function ReadPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;
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
