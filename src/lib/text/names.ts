import type { AnalyzedToken } from '../analyzer/types.ts';
import { toKatakana } from './kana.ts';
import { isKanaReading, type RubySpan } from './ruby.ts';

/** A name you confirmed in a work, and the reading its ruby gave, if any. */
export interface WorkName {
  surface: string;
  /** As the book wrote it, or null when the book never annotated the name. */
  reading: string | null;
}

/** Lexemes for names live in their own namespace, outside IPADIC and JMdict. */
export const NAME_DICTIONARY = 'name';

/**
 * Forces every occurrence of a work's names into one token.
 *
 * IPADIC splits names it does not know into whatever words their kanji spell --
 * 千遥 into 千 "thousand" and 遥 -- and no setting fixes that: kuromoji takes no
 * user dictionary at runtime. So the name is applied to the analyzer's output
 * instead, wherever an occurrence starts on a token's start and ends on a
 * token's end. One that cuts through a token is left as analysed, since there is
 * then no way to know the text means the name there.
 *
 * The merged token is filed under `NAME_DICTIONARY`, which is what keeps it out
 * of vocabulary: not marked, not counted, not matched against JMdict, and listed
 * in the Dictionary under 人名 instead.
 *
 * Longer names first, so a confirmed 小笛千遥 wins over 千遥 where both apply.
 */
export function applyNames(
  text: string,
  tokens: AnalyzedToken[],
  names: WorkName[],
): AnalyzedToken[] {
  if (names.length === 0 || tokens.length === 0) return tokens;

  const startAt = new Map<number, number>();
  const endAt = new Map<number, number>();
  tokens.forEach((token, index) => {
    startAt.set(token.charStart, index);
    endAt.set(token.charEnd, index);
  });

  // token index -> the name token replacing the run that starts there, and its length
  const merges = new Map<number, { token: AnalyzedToken; count: number }>();
  const taken = new Set<number>();

  for (const name of [...names].sort((a, b) => b.surface.length - a.surface.length)) {
    // Never across a line: a name does not continue into the next paragraph.
    if (name.surface === '' || name.surface.includes('\n')) continue;
    for (let at = text.indexOf(name.surface); at !== -1; at = text.indexOf(name.surface, at + 1)) {
      const first = startAt.get(at);
      const last = endAt.get(at + name.surface.length);
      if (first === undefined || last === undefined || last < first) continue;
      const run = Array.from({ length: last - first + 1 }, (_, i) => first + i);
      if (run.some((index) => taken.has(index))) continue;

      run.forEach((index) => taken.add(index));
      const reading = name.reading === null ? null : toKatakana(name.reading);
      merges.set(first, {
        count: run.length,
        token: {
          surface: name.surface,
          lemma: name.surface,
          lemmaReading: reading ?? '',
          reading,
          pos: '名詞',
          features: {
            posDetail1: '固有名詞',
            posDetail2: '人名',
            posDetail3: '*',
            conjugatedType: '*',
            conjugatedForm: '*',
            wordType: 'NAME',
          },
          charStart: at,
          charEnd: at + name.surface.length,
          dictionary: NAME_DICTIONARY,
        },
      });
    }
  }

  if (merges.size === 0) return tokens;
  const out: AnalyzedToken[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const merge = merges.get(index);
    if (merge) {
      out.push(merge.token);
      index += merge.count - 1;
    } else {
      out.push(tokens[index]!);
    }
  }
  return out;
}

/**
 * The reading the text's own ruby gives a name: a single ruby over exactly the
 * name, or consecutive ones that tile it (`｜千《ち》｜遥《はる》`), read left to
 * right. Null when no occurrence is annotated that way.
 */
export function rubyReadingOf(text: string, spans: RubySpan[], surface: string): string | null {
  for (let at = text.indexOf(surface); at !== -1; at = text.indexOf(surface, at + 1)) {
    const end = at + surface.length;
    // A gloss is not a reading: ＩＣＵ《集中治療室》 says what it means.
    const inside = spans
      .filter((span) => span.start >= at && span.end <= end && isKanaReading(span.reading))
      .sort((a, b) => a.start - b.start);
    let cursor = at;
    for (const span of inside) {
      if (span.start !== cursor) break;
      cursor = span.end;
    }
    if (inside.length > 0 && cursor === end) {
      return inside.map((span) => span.reading).join('');
    }
  }
  return null;
}
