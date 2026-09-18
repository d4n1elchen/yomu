/**
 * The grammar points in one sentence, ready to be shown as cards.
 *
 * Matching proposes and the model disposes: `matchSentence` finds every span
 * the inventory could explain, one request asks which of them are really that
 * grammar here, and what comes back is filed under ids the matcher already
 * knew. Nothing is stored -- a card is only a card until the reader adds it.
 *
 * This runs on a reader's behalf, so it announces itself through
 * `priority.ts`: the background drain stands down for it, the way a Q&A
 * question already makes it stand down.
 */

import { beginInteractive } from '../analysis/priority.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';
import type { GrammarLibrary, GrammarPoint } from './load.ts';
import type { GrammarMatch } from './match.ts';
import {
  buildIdentifyMessages,
  IDENTIFY_FORMAT,
  parseIdentification,
  type PromptSpan,
} from './identify-prompt.ts';

/** How much of the sentence rides along either side of a span, in characters. */
const CONTEXT = 8;

/** A card: a point, and where in the sentence it was found. */
export interface IdentifiedPoint {
  pointId: string;
  point: GrammarPoint;
  /** Offsets into the sentence, for marking the span on the card. */
  charStart: number;
  charEnd: number;
  /** The span as written, which for a conjugated form is a fragment. */
  surface: string;
}

export interface Identified {
  points: IdentifiedPoint[];
  /**
   * Grammar the model saw that the inventory has no point for -- ～てよかった,
   * ～とはいえ. Explained on the card, never addable: an addable one would be a
   * model-named entry. They are the worklist for the hand-written supplement.
   */
  others: { form: string; name: string }[];
  /**
   * The model was asked and gave a readable reply -- the only result worth
   * caching. False when there was nothing to ask, which is cheap to redo, and
   * when the reply was unreadable, which must be retried rather than
   * remembered as "no grammar here".
   */
  answered: boolean;
}

const NOTHING: Identified = { points: [], others: [], answered: false };

export interface IdentifyOptions {
  sentence: string;
  matches: GrammarMatch[];
  grammar: GrammarLibrary;
  provider?: LlmProvider;
  signal?: AbortSignal;
}

/**
 * A card is offered from difficulty A2 upwards, and never for a lone particle.
 *
 * Measured: with lone A1 particles in, a sentence offers 2.1 cards and 83 of
 * the 211 A1 accepts were に by itself; without them, 1.4 cards that are worth
 * reading. ている is two morphemes and stays, whatever its grade.
 *
 * The test is on the meaning the model **chose**, not on what was offered.
 * Judging by the candidates let every lone に through, because one of its eight
 * meanings (並立-対比) is graded A2 -- so the card said ～に（在…處）, an A1
 * meaning nobody needs a card for, on the strength of a meaning it had just
 * been rejected for.
 */
function worthACard(match: GrammarMatch, point: GrammarPoint): boolean {
  return match.end - match.start > 1 || point.difficulty !== 'A1';
}

/**
 * A point with no Chinese yet is not shown to the model or the reader.
 *
 * The prompt is built out of the Chinese name and gloss, and showing つつじ's
 * own labels instead measurably cost recall. A fresh import has none until
 * `npm run db:grammar-gloss` has run, and an ungrounded card is worse than no
 * card: the reader cannot judge what they would be adding.
 */
function described(point: GrammarPoint): point is GrammarPoint & {
  nameZh: string;
  glossZh: string;
} {
  return Boolean(point.nameZh && point.glossZh);
}

export async function identifyGrammar(options: IdentifyOptions): Promise<Identified> {
  const { sentence, matches, grammar } = options;

  const spans: PromptSpan[] = [];
  const offered: GrammarMatch[] = [];
  for (const match of matches) {
    const candidates = match.entryIds
      .map((id) => grammar.point(id))
      .filter((point): point is GrammarPoint => point !== undefined)
      .filter(described)
      .map((point) => ({
        pointId: point.id,
        name: point.nameZh,
        gloss: point.glossZh,
      }));
    if (candidates.length === 0) continue;

    offered.push(match);
    spans.push({
      n: spans.length + 1,
      surface: match.surface,
      before: sentence.slice(Math.max(0, match.charStart - CONTEXT), match.charStart),
      after: sentence.slice(match.charEnd, match.charEnd + CONTEXT),
      candidates,
    });
  }

  if (spans.length === 0) return NOTHING;

  const provider = options.provider ?? getLlmProvider();
  const done = beginInteractive();
  let reply: string;
  try {
    reply = await collect(
      provider.stream({
        messages: buildIdentifyMessages({ sentence, spans }),
        temperature: 0,
        format: IDENTIFY_FORMAT,
        signal: options.signal,
      }),
    );
  } finally {
    done();
  }

  const identification = parseIdentification(reply, spans);
  // An unreadable reply means no cards, not wrong cards. The reader still gets
  // the answer they asked for; grammar is the part that quietly did not arrive.
  if (!identification) return NOTHING;

  const points: IdentifiedPoint[] = [];
  const seen = new Set<string>();
  for (const [n, pointId] of identification.picks) {
    const match = offered[n - 1];
    const point = grammar.point(pointId);
    if (!match || !point) continue;
    if (!worthACard(match, point)) continue;
    // One point, one card, however often the sentence uses it: 通っている…
    // 送迎されている is two spans of ～ている and one thing to learn. The first
    // span is kept, because that is where the reader met it.
    if (seen.has(pointId)) continue;
    seen.add(pointId);
    points.push({
      pointId,
      point,
      charStart: match.charStart,
      charEnd: match.charEnd,
      surface: match.surface,
    });
  }
  points.sort((a, b) => a.charStart - b.charStart);

  return { points, others: identification.others, answered: true };
}
