import { ReviewCard } from '../../components/ReviewCard.tsx';
import { TsutsujiNotice } from '../../components/TsutsujiNotice.tsx';
import { keptCount } from '../../lib/grammar/library.ts';
import { dueGrammarCount, nextGrammarQuestion } from '../../lib/grammar/quiz.ts';

export const dynamic = 'force-dynamic';

/**
 * Review: the grammar you kept, coming back on a schedule, asked on the
 * sentences you kept it from.
 *
 * One question at a time, the one waiting longest, and "next" reloads this page
 * rather than keeping a queue in the browser -- the server decides what is due,
 * so a review started on the phone and finished on the laptop is one review.
 */
export default async function ReviewPage() {
  const now = Math.floor(Date.now() / 1000);
  const kept = keptCount();
  const due = dueGrammarCount(now);
  const question = nextGrammarQuestion(now);

  return (
    <main className="narrow">
      <h1>複習</h1>
      <p className="subtitle">
        {kept === 0
          ? '文法庫還是空的'
          : question
            ? `今天還有 ${due} 個句型要複習`
            : `文法庫共 ${kept} 個句型，目前都還不到複習的時候`}
      </p>

      {question ? (
        // Keyed on the point so an answered card is replaced, not reused with
        // its old choice still marked.
        <ReviewCard key={`${question.pointId}:${now}`} question={question} />
      ) : kept === 0 ? (
        <p className="empty">
          閱讀時在句子上雙擊，卡片上會列出句中的句型。加入文法庫的句型，會在這裡用你讀過的句子出題。
        </p>
      ) : (
        <p className="empty">
          現在沒有要複習的句型。答對的句型會隔一天、三天、一週……再回來；答錯的會在十分鐘後再出現。
          <a href="/dictionary?grammar=1">看文法庫</a>
        </p>
      )}

      <TsutsujiNotice />
    </main>
  );
}
