/**
 * When a kept item comes back for review.
 *
 * One scheduler for anything you keep, not one per kind. `user_lexeme_state`
 * and `user_grammar_state` carry the same three columns -- `familiarity`,
 * `lastReviewedAt`, `srsDue` -- so a word and a grammar point are scheduled by
 * the same rule, and a later quiz over both draws from one queue rather than
 * two that drift apart.
 *
 * A Leitner schedule, deliberately. `familiarity` is the box: a correct answer
 * moves the item up one and pushes it further out, a wrong one sends it back to
 * the start. It is the simplest schedule that behaves well, it is legible --
 * "you have got this right four times running" -- and the columns it needs
 * were already there. A fitted model such as FSRS earns its complexity with
 * review history this app does not have yet; measure first.
 */

/** Days until the next review, indexed by box. Box 0 is "not yet known". */
export const INTERVAL_DAYS = [0, 1, 3, 7, 16, 35, 90] as const;

/** The highest box: reviewed about quarterly, never retired. */
export const TOP_BOX = INTERVAL_DAYS.length - 1;

/**
 * How long a missed item waits before it may be asked again. Minutes, not a
 * day: seeing the answer is a moment of learning, and asking again later in the
 * same sitting is what consolidates it.
 */
export const RETRY_SECONDS = 10 * 60;

const DAY = 24 * 60 * 60;

/** The schedule as it is stored: unix seconds, like every timestamp here. */
export interface ScheduleState {
  familiarity: number;
  lastReviewedAt: number | null;
  srsDue: number | null;
}

/**
 * Due when it has never been reviewed or its time has come. A new item is due
 * at once: it was kept in context, and the first review is what turns meeting
 * it into knowing it.
 */
export function isDue(state: ScheduleState, now: number): boolean {
  return state.srsDue === null || state.srsDue <= now;
}

/** The schedule after one answer. */
export function grade(state: ScheduleState, correct: boolean, now: number): ScheduleState {
  if (!correct) {
    return { familiarity: 0, lastReviewedAt: now, srsDue: now + RETRY_SECONDS };
  }
  const box = Math.min(Math.max(state.familiarity, 0) + 1, TOP_BOX);
  return { familiarity: box, lastReviewedAt: now, srsDue: now + INTERVAL_DAYS[box]! * DAY };
}
