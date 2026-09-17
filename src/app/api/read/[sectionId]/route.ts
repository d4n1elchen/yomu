import { saveProgress, stampLastRead } from '../../../../lib/article.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A route handler rather than a server action: the reader fires this ten
 * seconds in, and an action would make Next refresh the current route's payload
 * -- re-fetching a whole chapter to record that it was being read.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const { sectionId } = await params;
  if (!stampLastRead(sectionId)) {
    return new Response('Section not found.', { status: 404 });
  }
  return new Response(null, { status: 204 });
}

/**
 * Where in the section you are: `{ "sentenceId": "..." }`. Sent by
 * `ReadingProgress` when scrolling settles and when the page is hidden, the
 * latter with `keepalive` -- which is why this is a route and not an action too.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const { sectionId } = await params;
  const body = (await request.json().catch(() => null)) as {
    sentenceId?: unknown;
  } | null;
  const sentenceId = body?.sentenceId;
  if (typeof sentenceId !== 'string' || sentenceId === '') {
    return new Response('Expected a sentenceId.', { status: 400 });
  }
  if (!saveProgress(sectionId, sentenceId)) {
    return new Response('No such sentence in this section.', { status: 404 });
  }
  return new Response(null, { status: 204 });
}
