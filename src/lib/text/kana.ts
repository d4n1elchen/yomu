const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const HIRAGANA_START = 0x3041; // ぁ
const HIRAGANA_END = 0x3096; // ゖ
const KANA_OFFSET = KATAKANA_START - HIRAGANA_START;

/**
 * Kanji, plus the iteration mark 々 which repeats the preceding kanji and has
 * to travel with it (時々 is one reading, not a kanji followed by a symbol).
 * The astral ranges cover the CJK extensions, where rare name kanji like 𠮷
 * and 𩸽 live.
 */
const KANJI_RE = /[一-龯㐀-䶿々\u{20000}-\u{323AF}]/u;

export function isKanji(char: string): boolean {
  return KANJI_RE.test(char);
}

export function isHiragana(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code >= HIRAGANA_START && code <= HIRAGANA_END;
}

export function isKatakana(char: string): boolean {
  const code = char.codePointAt(0);
  return code !== undefined && code >= KATAKANA_START && code <= KATAKANA_END;
}

export function isKana(char: string): boolean {
  return isHiragana(char) || isKatakana(char) || char === 'ー';
}

export function toHiragana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    out +=
      code >= KATAKANA_START && code <= KATAKANA_END
        ? String.fromCodePoint(code - KANA_OFFSET)
        : char;
  }
  return out;
}

export function toKatakana(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    out +=
      code >= HIRAGANA_START && code <= HIRAGANA_END
        ? String.fromCodePoint(code + KANA_OFFSET)
        : char;
  }
  return out;
}

export function containsKanji(text: string): boolean {
  return [...text].some(isKanji);
}

/** True for tokens that are punctuation, spacing, or symbols -- never tappable. */
export function isPunctuationOnly(text: string): boolean {
  return !/[\p{Letter}\p{Number}]/u.test(text);
}
