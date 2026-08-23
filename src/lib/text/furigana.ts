import { containsKanji, isKanji, toHiragana } from './kana.ts';

export interface RubySegment {
  text: string;
  /** Hiragana to render above `text`, or null to render `text` bare. */
  ruby: string | null;
}

interface Run {
  text: string;
  kanji: boolean;
}

/**
 * The analyzer gives one reading for a whole token: 食べた -> タベタ. Furigana
 * needs the kana attached to the kanji spans only -- 食(た)べた, not
 * 食べた(たべた) -- so the reading has to be split against the okurigana.
 *
 * The method: the kana written in the surface also appear, in order, in the
 * reading. Locating each kana run inside the reading reveals how much reading
 * the preceding kanji run consumed.
 *
 * Alignment is genuinely ambiguous in places (the same kana can appear twice),
 * and IPADIC does not supply a reading for every token. Both cases fall back to
 * carrying the whole reading over the whole surface: a misplaced reading is a
 * minor annoyance, a thrown exception loses the word.
 */
export function alignFurigana(
  surface: string,
  reading: string | null | undefined,
): RubySegment[] {
  const bare: RubySegment[] = [{ text: surface, ruby: null }];
  if (!reading) return bare;

  const target = toHiragana(reading);
  // Nothing to annotate, or the reading just restates the surface.
  if (!containsKanji(surface)) return bare;
  if (toHiragana(surface) === target) return bare;

  const whole: RubySegment[] = [{ text: surface, ruby: target }];
  const runs = splitRuns(surface);
  const segments: RubySegment[] = [];
  let cursor = 0;

  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;

    if (!run.kanji) {
      const literal = toHiragana(run.text);
      if (!target.startsWith(literal, cursor)) return whole;
      segments.push({ text: run.text, ruby: null });
      cursor += literal.length;
      continue;
    }

    const next = runs[i + 1];
    if (!next) {
      // Trailing kanji run takes whatever reading is left.
      const rest = target.slice(cursor);
      if (rest.length === 0) return whole;
      segments.push({ text: run.text, ruby: rest });
      cursor = target.length;
      continue;
    }

    // A kanji run consumes at least one kana, so search from cursor + 1.
    const anchor = toHiragana(next.text);
    const at = target.indexOf(anchor, cursor + 1);
    if (at === -1) return whole;
    segments.push({ text: run.text, ruby: target.slice(cursor, at) });
    cursor = at;
  }

  // Every kana of the reading must have been accounted for.
  if (cursor !== target.length) return whole;
  return segments;
}

function splitRuns(surface: string): Run[] {
  const runs: Run[] = [];
  for (const char of surface) {
    const kanji = isKanji(char);
    const last = runs[runs.length - 1];
    if (last && last.kanji === kanji) last.text += char;
    else runs.push({ text: char, kanji });
  }
  return runs;
}
