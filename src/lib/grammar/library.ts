/**
 * The 文法庫: grammar points you have kept, and the sentences you kept them from.
 *
 * Nothing enters it except by an add you made on a card. The model proposes
 * the points, but it never writes here -- the earlier design let Q&A decide
 * what was new, and a model deciding novelty produced near-duplicates. The key
 * is つつじ's id, so the same point met in two sentences is one entry with two
 * examples, however differently it was written each time.
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import {
  grammarOccurrences,
  grammarPoints,
  sentences,
  userGrammarState,
} from '../../db/schema.ts';

/** One place a point was met, as the card recorded it. */
export interface GrammarExample {
  pointId: string;
  sentenceId: string;
  /** The revision the span was found against: see `grammar_occurrence`. */
  sentenceRevision: number;
  charStart: number;
  charEnd: number;
  surface: string;
}

/**
 * Keeps a point, with the sentence it was met in as an example.
 *
 * Adding a point already kept adds only the example -- the card's
 * ＋加入這個例句 -- and adding an example already there is not an error. Both
 * are the same tap on the card, so both are the same call here.
 */
export function keepGrammarPoint(example: GrammarExample): void {
  const known = db
    .select({ id: grammarPoints.id })
    .from(grammarPoints)
    .where(eq(grammarPoints.id, example.pointId))
    .get();
  // Only ids the inventory has can be kept. The card only ever offers those,
  // and anything else is a request that did not come from a card.
  if (!known) throw new Error(`Unknown grammar point ${example.pointId}.`);

  db.transaction((tx) => {
    tx.insert(userGrammarState)
      .values({ pointId: example.pointId })
      .onConflictDoNothing()
      .run();
    tx.insert(grammarOccurrences)
      .values(example)
      .onConflictDoNothing()
      .run();
  });
}

/**
 * Removes a point from the library, and its examples with it.
 *
 * The examples only exist to illustrate a kept point; left behind, they would
 * be sentences filed under something you said you did not want.
 */
export function releaseGrammarPoint(pointId: string): void {
  db.transaction((tx) => {
    tx.delete(grammarOccurrences).where(eq(grammarOccurrences.pointId, pointId)).run();
    tx.delete(userGrammarState).where(eq(userGrammarState.pointId, pointId)).run();
  });
}

/** What a card needs to know about each point it offers. */
export interface KeptState {
  kept: boolean;
  /** How many sentences you have kept for it, this one included. */
  examples: number;
  /** Whether this very sentence is already one of them. */
  thisSentence: boolean;
}

/**
 * The library state of several points at once, as seen from one sentence --
 * one query per table rather than one per card.
 */
export function keptStates(
  pointIds: string[],
  sentenceId: string,
): Map<string, KeptState> {
  const states = new Map<string, KeptState>(
    pointIds.map((id) => [id, { kept: false, examples: 0, thisSentence: false }]),
  );
  if (pointIds.length === 0) return states;

  for (const row of db
    .select({ pointId: userGrammarState.pointId })
    .from(userGrammarState)
    .where(inArray(userGrammarState.pointId, pointIds))
    .all()) {
    states.get(row.pointId)!.kept = true;
  }

  for (const row of db
    .select({
      pointId: grammarOccurrences.pointId,
      examples: sql<number>`count(*)`,
      here: sql<number>`sum(${grammarOccurrences.sentenceId} = ${sentenceId})`,
    })
    .from(grammarOccurrences)
    .where(inArray(grammarOccurrences.pointId, pointIds))
    .groupBy(grammarOccurrences.pointId)
    .all()) {
    const state = states.get(row.pointId)!;
    state.examples = row.examples;
    state.thisSentence = row.here > 0;
  }

  return states;
}

/** How many points are in the library -- what the Library row and header count. */
export function keptCount(): number {
  return db.select({ n: sql<number>`count(*)` }).from(userGrammarState).get()!.n;
}

/** A kept point as the Dictionary lists it. */
export interface KeptPoint {
  pointId: string;
  base: string;
  nameZh: string | null;
  glossZh: string | null;
  difficulty: string;
  meaningClass: string;
  examples: number;
  addedAt: number;
}

/**
 * Every kept point, newest first.
 *
 * A point whose つつじ row has gone -- a future re-import that dropped it --
 * still lists, under its id, rather than vanishing: it is something you chose
 * to learn, and the same policy keeps an orphaned 生詞 on the list.
 */
export function keptPoints(): KeptPoint[] {
  return db
    .select({
      pointId: userGrammarState.pointId,
      base: sql<string>`coalesce(${grammarPoints.base}, ${userGrammarState.pointId})`,
      nameZh: grammarPoints.nameZh,
      glossZh: grammarPoints.glossZh,
      difficulty: sql<string>`coalesce(${grammarPoints.difficulty}, '')`,
      meaningClass: sql<string>`coalesce(${grammarPoints.meaningClass}, '')`,
      examples: sql<number>`(select count(*) from ${grammarOccurrences} where ${grammarOccurrences.pointId} = ${userGrammarState.pointId})`,
      addedAt: userGrammarState.addedAt,
    })
    .from(userGrammarState)
    .leftJoin(grammarPoints, eq(grammarPoints.id, userGrammarState.pointId))
    .orderBy(sql`${userGrammarState.addedAt} desc`, asc(userGrammarState.pointId))
    .all();
}

/** One example, with the sentence as it now reads and whether it has moved. */
export interface ExampleSentence {
  sentenceId: string;
  sectionId: string;
  text: string;
  charStart: number;
  charEnd: number;
  /**
   * The sentence was edited after the example was kept, so the offsets may no
   * longer mark the right characters. Shown without the mark rather than with a
   * wrong one.
   */
  stale: boolean;
}

/** A kept point's examples, oldest first -- the order you met them in. */
export function examplesOf(pointId: string): ExampleSentence[] {
  return db
    .select({
      sentenceId: grammarOccurrences.sentenceId,
      sectionId: sentences.sectionId,
      text: sentences.text,
      charStart: grammarOccurrences.charStart,
      charEnd: grammarOccurrences.charEnd,
      stale: sql<number>`${sentences.revision} != ${grammarOccurrences.sentenceRevision}`,
    })
    .from(grammarOccurrences)
    .innerJoin(sentences, eq(sentences.id, grammarOccurrences.sentenceId))
    .where(eq(grammarOccurrences.pointId, pointId))
    .orderBy(asc(grammarOccurrences.addedAt))
    .all()
    .map((row) => ({ ...row, stale: Boolean(row.stale) }));
}

/** Whether a point is kept -- for a single card, without the batch query. */
export function isKept(pointId: string): boolean {
  return (
    db
      .select({ id: userGrammarState.pointId })
      .from(userGrammarState)
      .where(and(eq(userGrammarState.pointId, pointId)))
      .get() !== undefined
  );
}
