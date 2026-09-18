import { askAboutSentence, type AskGrammarRef } from '../../../lib/qa/ask.ts';
import type { LlmMessage } from '../../../lib/llm/index.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AskBody {
  sentenceId?: unknown;
  turns?: unknown;
  grammar?: unknown;
}

/**
 * The points the card showed. Malformed items are skipped rather than failing
 * the question: the grammar block is a help to the answer, not a precondition.
 * The ids are checked against the inventory later, in `resolveAskGrammar`.
 */
function parseGrammar(raw: unknown): AskGrammarRef[] {
  if (!Array.isArray(raw)) return [];
  const refs: AskGrammarRef[] = [];
  for (const item of raw.slice(0, 20)) {
    if (typeof item !== 'object' || item === null) continue;
    const { pointId, surface } = item as Record<string, unknown>;
    if (typeof pointId !== 'string' || typeof surface !== 'string') continue;
    if (!pointId || !surface) continue;
    refs.push({ pointId, surface });
  }
  return refs;
}

/**
 * The whole thread travels with every request, because nothing is stored: the
 * client holds the conversation and the server holds no session at all.
 */
function parseTurns(raw: unknown): LlmMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const turns: LlmMessage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { role, content } = item as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') return null;
    if (typeof content !== 'string' || content.trim().length === 0) return null;
    turns.push({ role, content: content.trim() });
  }

  // A thread the model can answer alternates, starts with the reader, and ends
  // with the question being asked now.
  if (turns[0]!.role !== 'user') return null;
  if (turns.at(-1)!.role !== 'user') return null;
  for (let i = 1; i < turns.length; i += 1) {
    if (turns[i]!.role === turns[i - 1]!.role) return null;
  }
  return turns;
}

/**
 * Streamed as plain text rather than returned whole: a 27B model takes tens of
 * seconds, and watching the answer arrive is the difference between "thinking"
 * and "hung".
 */
export async function POST(request: Request) {
  let body: AskBody;

  try {
    body = await request.json();
  } catch {
    return new Response('Malformed request body.', { status: 400 });
  }

  const sentenceId =
    typeof body.sentenceId === 'string' && body.sentenceId.length > 0
      ? body.sentenceId
      : null;
  const turns = parseTurns(body.turns);

  if (!sentenceId || !turns) {
    return new Response('A sentence and an alternating thread are required.', {
      status: 400,
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of askAboutSentence({
          sentenceId,
          turns,
          grammar: parseGrammar(body.grammar),
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
