import { askAboutSentence } from '../../../lib/qa/ask.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streamed as plain text rather than returned whole: a 27B model takes tens of
 * seconds, and watching the answer arrive is the difference between "thinking"
 * and "hung".
 */
export async function POST(request: Request) {
  let body: {
    sentenceId?: string;
    question?: string;
    charStart?: number | null;
    charEnd?: number | null;
  };

  try {
    body = await request.json();
  } catch {
    return new Response('Malformed request body.', { status: 400 });
  }

  const sentenceId = body.sentenceId?.trim();
  const question = body.question?.trim();

  if (!sentenceId || !question) {
    return new Response('sentenceId and question are required.', {
      status: 400,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of askAboutSentence({
          sentenceId,
          question,
          charStart: body.charStart ?? null,
          charEnd: body.charEnd ?? null,
          signal: request.signal,
        })) {
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        // The response has already begun, so the failure has to travel in the
        // body rather than as a status code.
        const message =
          error instanceof Error ? error.message : 'Unknown failure.';
        controller.enqueue(encoder.encode(`\n\n[錯誤] ${message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}
