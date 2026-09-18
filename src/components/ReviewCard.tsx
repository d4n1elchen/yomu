'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { answerGrammar } from '../app/review/actions.ts';
import type { GrammarQuestion } from '../lib/grammar/quiz.ts';

/**
 * One review question: your sentence, the point marked in it, and what it means.
 *
 * The answer is shown whichever way it went -- the right choice marked, and
 * a wrong choice marked as wrong beside it -- because a miss is exactly the
 * moment the meaning is worth reading again. The next question waits for a tap
 * rather than arriving on its own, for the same reason.
 */
export function ReviewCard({ question }: { question: GrammarQuestion }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<string | null>(null);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);

  const choose = async (pointId: string) => {
    if (chosen !== null || pending) return;
    setChosen(pointId);
    setPending(true);
    const result = await answerGrammar(question.pointId, pointId).catch(() => null);
    setPending(false);
    // Unreachable server: the answer was not recorded, so it is not graded here
    // either -- the question stays, and can be answered again.
    if (!result) {
      setChosen(null);
      return;
    }
    setCorrect(result.correct);
  };

  const { sentence, charStart, charEnd } = question;

  return (
    <div className="review-card">
      <p className="review-sentence" lang="ja">
        {sentence.slice(0, charStart)}
        <mark>{sentence.slice(charStart, charEnd)}</mark>
        {sentence.slice(charEnd)}
      </p>
      <p className="review-source">
        <a href={`/read/${question.sectionId}#sentence-${question.sentenceId}`} lang="ja">
          {question.workTitle}
        </a>
      </p>

      <p className="review-prompt">
        這裡的「<span lang="ja">～{question.base}</span>」是什麼意思？
      </p>

      <ol className="review-choices">
        {question.choices.map((choice) => {
          const state =
            chosen === null || pending
              ? ''
              : choice.pointId === question.pointId
                ? 'right'
                : choice.pointId === chosen
                  ? 'wrong'
                  : 'dim';
          return (
            <li key={choice.pointId}>
              <button
                type="button"
                className={`review-choice ${state}`}
                disabled={chosen !== null}
                onClick={() => void choose(choice.pointId)}
              >
                {choice.text}
              </button>
            </li>
          );
        })}
      </ol>

      {correct !== null ? (
        <div className="review-after">
          <p className={correct ? 'review-verdict right' : 'review-verdict wrong'}>
            {correct ? '答對了。' : '答錯了，這一題稍後會再出現。'}
          </p>
          <div className="review-next">
            <a href={`/dictionary/grammar/${question.pointId}`}>看這個句型</a>
            <button type="button" onClick={() => router.refresh()}>
              下一題
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
