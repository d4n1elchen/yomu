/**
 * Remembers what the grammar card found in a sentence, so reopening it is
 * instant and shows the same cards.
 *
 * A cache and nothing more: rows hold ids and spans only, are used only while
 * the sentence revision and the version below both match, and can be deleted
 * at any time without losing anything the reader did. What the reader keeps
 * lives in `grammar_occurrence`, which this never touches.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { grammarAnalyses } from '../../db/schema.ts';
import { IDENTIFY_PROMPT_TEXT } from './identify-prompt.ts';
import type { Identified, IdentifiedPoint } from './identify.ts';
import type { GrammarLibrary } from './load.ts';

/**
 * Bump when what a sentence yields changes in code the other parts of the
 * version cannot see: the matcher's rules, the A2 floor, one card per point.
 * The prompt, the model and the inventory are fingerprinted on their own.
 */
export const ANALYSIS_LOGIC = 1;

/**
 * Everything an analysis depends on, as one short string. Two opens of a
 * sentence share a cached answer only if they would have asked the same model
 * the same question about the same inventory.
 */
export function analysisVersion(model: string, library: GrammarLibrary): string {
  return createHash('sha256')
    .update(`${ANALYSIS_LOGIC}\n${model}\n${library.stamp}\n${IDENTIFY_PROMPT_TEXT}`)
    .digest('hex')
    .slice(0, 16);
}

interface StoredPoint {
  pointId: string;
  charStart: number;
  charEnd: number;
  surface: string;
}

export function readAnalysis(
  sentenceId: string,
  revision: number,
  version: string,
  library: GrammarLibrary,
): Identified | null {
  const row = db
    .select()
    .from(grammarAnalyses)
    .where(eq(grammarAnalyses.sentenceId, sentenceId))
    .get();
  if (!row || row.sentenceRevision !== revision || row.version !== version) return null;

  const points: IdentifiedPoint[] = [];
  for (const stored of JSON.parse(row.points) as StoredPoint[]) {
    const point = library.point(stored.pointId);
    // Cannot happen while the stamp matches, but a missing point is a card
    // with nothing to say -- dropped rather than shown blank.
    if (!point) continue;
    points.push({ ...stored, point });
  }
  return {
    points,
    others: JSON.parse(row.others) as Identified['others'],
    answered: true,
  };
}

/** Stores an answered analysis, replacing whatever the sentence had before. */
export function writeAnalysis(
  sentenceId: string,
  revision: number,
  version: string,
  identified: Identified,
): void {
  const values = {
    sentenceRevision: revision,
    version,
    points: JSON.stringify(
      identified.points.map(
        ({ pointId, charStart, charEnd, surface }): StoredPoint => ({
          pointId,
          charStart,
          charEnd,
          surface,
        }),
      ),
    ),
    others: JSON.stringify(identified.others),
    analysedAt: Math.floor(Date.now() / 1000),
  };
  db.insert(grammarAnalyses)
    .values({ sentenceId, ...values })
    .onConflictDoUpdate({ target: grammarAnalyses.sentenceId, set: values })
    .run();
}
