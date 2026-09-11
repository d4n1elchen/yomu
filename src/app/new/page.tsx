import { EpubForm } from '../../components/EpubForm.tsx';
import { ImportForm } from '../../components/ImportForm.tsx';

export const dynamic = 'force-dynamic';

/** Adding an article is a page, not a dialog and not part of the Library. */
export default function NewArticlePage() {
  return (
    <main className="narrow">
      <p className="back">
        <a href="/library">← 文章庫</a>
      </p>

      <h1>新增文章</h1>
      <p className="subtitle">貼上日文。新詞會加入辭典。</p>

      <ImportForm />

      <h2 className="divider">或匯入整本書</h2>
      <p className="subtitle">EPUB 會依照書本自己的目次分章。</p>

      <EpubForm />
    </main>
  );
}
