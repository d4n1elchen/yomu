/**
 * Review for grammar you kept: a sentence you met the point in, the point
 * marked, and the question "what does it mean here?"
 *
 * **A recognition question, not a cloze.** The plan had the point's
 * 意味的等価クラス peers as the wrong answers to a blank. They are
 * paraphrases by definition -- ので fits a blank that から fits -- so a cloze
 * built on them marks right answers wrong, and their generated glosses came out
 * near-identical besides. This is a reading app, and the skill it builds is
 * knowing what a form means when you meet it, so that is what is asked.
 *
 * The wrong answers come first from **the same form's other meanings** --
 * ために "because" against ために "in order to", ながら "while" against
 * ながら "although". That is the confusion a reader actually has, and the one a
 * sentence can settle. Other points at the same level fill the rest.
 *
 * The sentence is your own, from where you kept the point, and a different one
 * each day when you kept more than one -- so what is learned is the point, not
 * one sentence's shape.
 */

import { and, asc, eq, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { grammarPoints, userGrammarState } from '../../db/schema.ts';
import { grade, isDue } from '../review/schedule.ts';
import { examplesOf } from './library.ts';

/** Answers offered, the right one included. */
const CHOICES = 4;

const DAY = 24 * 60 * 60;

export interface QuizChoice {
  pointId: string;
  /** Traditional Chinese: the name and gloss the card showed. */
  text: string;
}

export interface GrammarQuestion {
  pointId: string;
  /** The point's form, as the question names it: ～ために. */
  base: string;
  sentence: string;
  sentenceId: string;
  sectionId: string;
  workTitle: string;
  charStart: number;
  charEnd: number;
  choices: QuizChoice[];
}

/** How many kept points are due now -- what the 複習 tab counts. */
export function dueGrammarCount(now: number): number {
  return db
    .select({ n: sql<number>`count(*)` })
    .from(userGrammarState)
    .innerJoin(grammarPoints, eq(grammarPoints.id, userGrammarState.pointId))
    .where(or(isNull(userGrammarState.srsDue), lte(userGrammarState.srsDue, now)))
    .get()!.n;
}

/**
 * A stable shuffle: the same question shows the same order on a reload, and a
 * different one tomorrow. Math.random would reorder the answers each time the
 * page renders, which reads as the question changing under you.
 */
function seeded(key: string): () => number {
  let h = 2166136261;
  for (const ch of key) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * The meaning only, never the form. A name reads ～てくる（向現在持續）, and
 * with the form left in, the right choice is simply the one starting with the
 * form the question just named -- found in the browser, where every question
 * answered itself. The parenthesis is kept: for two meanings of one form it is
 * the whole difference (因為… against 為了…).
 */
function choiceText(point: { nameZh: string | null; glossZh: string | null }): string {
  const sense = point.nameZh?.match(/（(.+)）$/u)?.[1];
  if (sense && point.glossZh) return `${sense}：${point.glossZh}`;
  return point.glossZh ?? sense ?? '';
}

/** The question for the next due point, or null when nothing is due. */
export function nextGrammarQuestion(now: number): GrammarQuestion | null {
  // A due point with no usable sentence -- every example deleted with its
  // article, or edited since -- is skipped rather than asked without context.
  // It stays due, and returns as soon as it has a sentence again.
  const tried = new Set<string>();
  for (;;) {
    const pointId = nextDueExcept(now, tried);
    if (!pointId) return null;
    tried.add(pointId);
    const question = questionFor(pointId, now);
    if (question) return question;
  }
}

/**
 * The next point to ask about, skipping any already found unaskable: the one
 * waiting longest. Never-reviewed points come first, oldest kept first, so a
 * point is asked about in the order it was met. A point whose つつじ row is
 * gone cannot be asked about -- there is no meaning to offer -- and waits
 * rather than breaking the queue.
 */
function nextDueExcept(now: number, skip: Set<string>): string | null {
  const rows = db
    .select({ pointId: userGrammarState.pointId })
    .from(userGrammarState)
    .innerJoin(grammarPoints, eq(grammarPoints.id, userGrammarState.pointId))
    .where(or(isNull(userGrammarState.srsDue), lte(userGrammarState.srsDue, now)))
    .orderBy(
      sql`${userGrammarState.srsDue} is not null`,
      asc(userGrammarState.srsDue),
      asc(userGrammarState.addedAt),
    )
    .all();
  return rows.find((row) => !skip.has(row.pointId))?.pointId ?? null;
}

/** Builds the question for one point, or null when it has no usable sentence. */
export function questionFor(pointId: string, now: number): GrammarQuestion | null {
  const point = db.select().from(grammarPoints).where(eq(grammarPoints.id, pointId)).get();
  if (!point) return null;

  const examples = examplesOf(pointId).filter((example) => !example.stale);
  if (examples.length === 0) return null;

  // A different sentence each day, when there is more than one.
  const day = Math.floor(now / DAY);
  const example = examples[day % examples.length]!;

  // The same form's other meanings first: the confusion a sentence settles.
  const sameForm = db
    .select()
    .from(grammarPoints)
    .where(and(eq(grammarPoints.base, point.base), ne(grammarPoints.id, pointId)))
    .all()
    .filter((other) => other.nameZh);

  // Then other points at the same level, from other meaning classes -- never
  // the point's own class, whose members paraphrase it and would be right too.
  const random = seeded(`${pointId}:${day}`);
  const sameLevel = shuffled(
    db
      .select()
      .from(grammarPoints)
      .where(
        and(
          eq(grammarPoints.difficulty, point.difficulty),
          ne(grammarPoints.meaningClass, point.meaningClass),
          ne(grammarPoints.base, point.base),
        ),
      )
      .all()
      .filter((other) => other.nameZh),
    random,
  );

  const wrong = [...shuffled(sameForm, random), ...sameLevel].slice(0, CHOICES - 1);
  const choices = shuffled(
    [point, ...wrong].map((p) => ({ pointId: p.id, text: choiceText(p) })),
    random,
  );

  return {
    pointId,
    base: point.base,
    sentence: example.text,
    sentenceId: example.sentenceId,
    sectionId: example.sectionId,
    workTitle: example.workTitle,
    charStart: example.charStart,
    charEnd: example.charEnd,
    choices,
  };
}

/**
 * Records an answer and reschedules the point. Returns whether it was right,
 * so the page can say so either way.
 */
export function answerGrammarQuestion(
  pointId: string,
  chosenId: string,
  now: number,
): { correct: boolean } {
  const state = db
    .select({
      familiarity: userGrammarState.familiarity,
      lastReviewedAt: userGrammarState.lastReviewedAt,
      srsDue: userGrammarState.srsDue,
    })
    .from(userGrammarState)
    .where(eq(userGrammarState.pointId, pointId))
    .get();
  // An answer for a point no longer kept -- removed in another tab -- is not an
  // error, and there is nothing to reschedule.
  if (!state) return { correct: chosenId === pointId };

  // A stale page re-submitting an answer the point already had must not count
  // twice: only a point that is actually due is graded.
  const correct = chosenId === pointId;
  if (!isDue(state, now)) return { correct };

  db.update(userGrammarState)
    .set(grade(state, correct, now))
    .where(eq(userGrammarState.pointId, pointId))
    .run();
  return { correct };
}
