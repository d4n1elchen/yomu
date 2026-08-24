/**
 * Which words get the dashed underline.
 *
 * One definition, because the reader marks the words and also counts them, and
 * a count that disagrees with the underlines is worse than no count.
 */

/** JMdict's `nf` bands run nf01 to nf48: the top 24,000 words, 500 at a time. */
export const MAX_BAND = 48;

/**
 * The vocabulary the reader is assumed to know already, as a band. 20 is the
 * top 10,000 words -- comfortable-intermediate, and a starting point to move
 * rather than a claim about anybody.
 */
export const DEFAULT_LEVEL = 20;

export interface Markable {
  /** Decided by `contentWord` in SQL; particles and punctuation are never marked. */
  contentWord: boolean;
  /** JMdict frequency band, or null for rarer-than-24,000 and for no match. */
  band: number | null;
  /** JMdict calls the word common even though the corpus never ranked it. */
  common: boolean;
}

/**
 * A word is hard when it is vocabulary and nothing vouches for it being common.
 *
 * The two signals answer different questions and both are needed. `band` is a
 * newspaper corpus ranking and gives the gradation the slider moves along.
 * `common` is JMdict's own priority flag and is the floor: 7,726 entries the
 * dictionary marks common were never ranked by that corpus -- 本 among them --
 * and reading a null band as "rarer than the 24,000th" would put a dashed
 * underline under the word for "book".
 *
 * A word that is neither ranked nor flagged is still marked, and deliberately.
 * It is either genuinely rare or matched no entry at all, and both are the
 * reader meeting something no dictionary calls ordinary.
 */
export function isHardWord(word: Markable, level: number): boolean {
  if (!word.contentWord) return false;
  if (word.band !== null) return word.band > level;
  return !word.common;
}
