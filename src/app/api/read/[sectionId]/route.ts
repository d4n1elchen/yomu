import { isReadable } from '../../../../lib/analysis/drain.ts';
import { getArticle, saveProgress, stampLastRead } from '../../../../lib/article.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The whole chapter, for downloading one from the contents list without opening
 * it. The reader already holds its own chapter; the other fourteen in the list
 * are only titles until they are fetched. Refused while resolution is still
 * moving the chapter's links, for the reason the reader page turns it away.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sectionId: string }> },
) {
  const { sectionId } = await params;
  if (!isReadable(sectionId)) {
    return new Response('Section not readable yet.', { status: 409 });
  }
  const article = getArticle(sectionId);
  if (!article) return new Response('Section not found.', { status: 404 });
  return Response.json(article);
}

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
