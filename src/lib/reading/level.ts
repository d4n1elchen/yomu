import { DEFAULT_LEVEL, MAX_BAND } from '../marking.ts';

/**
 * Where the difficulty slider was left, kept on this device.
 *
 * localStorage rather than the database: it is a preference about this reader
 * on this screen, and the reader also runs offline, where a server round trip
 * could not save it anyway.
 */
export const LEVEL_KEY = 'yomu.level';

/**
 * A stored value read back. Anything that is not a whole band in range -- an
 * absent key, a value written by some older build, a hand-edited one -- falls
 * back to the default rather than marking every word or none.
 */
export function parseLevel(raw: string | null): number {
  if (raw === null) return DEFAULT_LEVEL;
  const level = Number(raw);
  if (!Number.isInteger(level) || level < 1 || level > MAX_BAND) {
    return DEFAULT_LEVEL;
  }
  return level;
}

/** Storage can be missing or throw (private mode, blocked site data). */
export function loadLevel(): number {
  try {
    return parseLevel(window.localStorage.getItem(LEVEL_KEY));
  } catch {
    return DEFAULT_LEVEL;
  }
}

export function saveLevel(level: number): void {
  try {
    window.localStorage.setItem(LEVEL_KEY, String(level));
  } catch {
    // Not remembered; the slider still works for this visit.
  }
}
