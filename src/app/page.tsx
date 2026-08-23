import { ImportForm } from '../components/ImportForm.tsx';
import { listWorks } from '../lib/lesson.ts';

export const dynamic = 'force-dynamic';

export default function HomePage() {
  const works = listWorks();

  return (
    <main>
      <h1>Yomu</h1>
      <p className="subtitle">
        読んで、覚える。 · <a href="/library">library</a>
      </p>

      <ImportForm />

      <h2 style={{ fontSize: '0.8rem', letterSpacing: '0.08em', color: 'var(--muted)', margin: '2.5rem 0 0.5rem', fontFamily: 'system-ui, sans-serif' }}>
        LESSONS
      </h2>
      {works.length === 0 ? (
        <p className="empty">Nothing imported yet.</p>
      ) : (
        <ul className="works">
          {works.map((work) => (
            <li key={work.sectionId}>
              <a href={`/lesson/${work.sectionId}`}>
                {work.title}
                <span className="meta">
                  {new Date(work.createdAt * 1000).toLocaleDateString()}
                  {work.author ? ` · ${work.author}` : ''}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
