import { keptStates } from '../../../lib/grammar/library.ts';
import { loadGrammar } from '../../../lib/grammar/load.ts';
import { grammarInSentence } from '../../../lib/grammar/sentence.ts';

/** Similar expressions shown beside a point. Enough to place it, not a list. */
const PEERS = 4;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GrammarBody {
  sentenceId?: unknown;
  /** 重新分析: skip the cached analysis and ask the model again. */
  fresh?: unknown;
}

/**
 * The grammar points in one sentence, as JSON rather than a stream.
 *
 * Unlike an answer, there is nothing to watch arrive: the reply is a short list
 * and the card has nothing to show until all of it is there. It takes about
 * 8.5s the first time a sentence is opened and nothing after that: the answer
 * is cached per sentence (`src/lib/grammar/cache.ts`), which matters because
 * the card waits for it before taking a question.
 *
 * A failure here is empty-handed, not fatal: the reader still has the
 * conversation, and grammar is the part that quietly did not arrive. The status
 * says which, so the card can say 暫時找不到 rather than pretending the
 * sentence has no grammar in it.
 */
export async function POST(request: Request) {
  let body: GrammarBody;
  try {
    body = await request.json();
  } catch {
    return new Response('Malformed request body.', { status: 400 });
  }

  const sentenceId =
    typeof body.sentenceId === 'string' && body.sentenceId.length > 0
      ? body.sentenceId
      : null;
  if (!sentenceId) {
    return new Response('A sentence is required.', { status: 400 });
  }

  try {
    const grammar = await grammarInSentence(sentenceId, {
      signal: request.signal,
      fresh: body.fresh === true,
    });
    // Whether each point is already in the 文法庫, and whether this sentence is
    // already one of its examples -- what decides between ＋加入文法庫,
    // ＋加入這個例句 and nothing to add at all.
    const states = keptStates(
      grammar.points.map((point) => point.pointId),
      sentenceId,
    );
    return Response.json(
      {
        revision: grammar.revision,
        points: grammar.points.map((point) => ({
          pointId: point.pointId,
          ...states.get(point.pointId)!,
          name: point.point.nameZh,
          gloss: point.point.glossZh,
          base: point.point.base,
          difficulty: point.point.difficulty,
          charStart: point.charStart,
          charEnd: point.charEnd,
          surface: point.surface,
          // 意味的等価クラス siblings: から beside ので. Related, never merged,
          // and what tells the reader which of two neighbouring points this card is.
          peers: loadGrammar()
            .peers(point.pointId)
            .slice(0, PEERS)
            .map((peer) => peer.base),
        })),
        others: grammar.others,
        cached: grammar.cached,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    // An abort is the reader closing the card before the model answered. It is
    // not a failure to report: nobody is listening, and the client has already
    // thrown its own request away.
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const message = error instanceof Error ? error.message : 'Unknown failure.';
    return new Response(message, { status: 502 });
  }
}
