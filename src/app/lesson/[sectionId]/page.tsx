import { notFound } from 'next/navigation';
import { LessonReader } from '../../../components/LessonReader.tsx';
import { getLesson } from '../../../lib/lesson.ts';
import { listQuestionsForSection } from '../../../lib/qa/ask.ts';

export const dynamic = 'force-dynamic';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ sectionId: string }>;
}) {
  const { sectionId } = await params;
  const lesson = getLesson(sectionId);
  if (!lesson) notFound();

  return (
    <main>
      <h1>{lesson.sectionTitle ?? lesson.workTitle}</h1>
      <p className="subtitle">
        {lesson.sentences.length} sentences
        {lesson.author ? ` · ${lesson.author}` : ''}
      </p>
      <LessonReader
        lesson={lesson}
        questions={listQuestionsForSection(sectionId)}
      />
    </main>
  );
}
