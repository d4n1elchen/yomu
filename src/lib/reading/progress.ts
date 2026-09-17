/**
 * Which sentence is "where you are": the last one to have started at or above
 * the reading line -- the top of the text area, just under the sticky header.
 *
 * Takes each sentence's first-line top in document order rather than elements,
 * so it can be tested without a DOM. A later sentence never starts above an
 * earlier one, so the tops are non-decreasing and a binary search holds -- a
 * novel chapter is thousands of sentences.
 *
 * **Started, not "still visible", and that choice is what keeps the bookmark
 * still.** Sentences are inline, so one often ends on the same line the next
 * begins. The reader resumes by putting a sentence's first line on the reading
 * line; judged by "first sentence whose bottom is still below the line", the
 * sentence ending on that same line would be picked instead, and every open
 * would walk the bookmark back a line. Judged by where sentences start, resuming
 * at a sentence reports that sentence again: a fixed point.
 *
 * Two edges are answered differently, and both came from switching chapters:
 *
 * - **Above the text there is no position** (-1). The title and the 目次 sit
 *   there, so scrolling up to pick another chapter used to report the first
 *   sentence and overwrite the bookmark with the start of the chapter.
 * - **At the bottom of the page you are at the last sentence.** The final
 *   screenful can never scroll up to the reading line, so finishing a chapter
 *   left its bookmark a screen short of the end, and its progress short of
 *   100%. `atEnd` means the page cannot scroll any further.
 *
 * Returns -1 for no sentences too.
 */
export function currentSentence(
  tops: readonly number[],
  line: number,
  atEnd = false,
): number {
  if (tops.length === 0) return -1;
  if (atEnd) return tops.length - 1;
  if (tops[0]! > line) return -1;
  let low = 0;
  let high = tops.length - 1;
  // The last index whose top is <= line; index 0 is known to qualify.
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (tops[mid]! <= line) low = mid;
    else high = mid - 1;
  }
  return low;
}
