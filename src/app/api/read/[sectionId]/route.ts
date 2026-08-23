import { stampLastRead } from '../../../../lib/article.ts';

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
