/**
 * The JIS X 0213:2004 print forms, folded to the forms IPADIC was built on.
 *
 * Publishers switched to the 2004 印刷標準字体 -- Kadokawa among them -- and
 * IPADIC predates them, so 繫がる arrives as an unknown 繫 plus a がる suffix and
 * 摑む as 摑 + む. Every word written with one of these kanji falls apart, and the
 * pieces reach the Dictionary as junk single-kanji entries. Measured on the
 * first book imported: 繫 17, 吞 12, 摑 12, 搔 9, and a tail of others -- more
 * than every other cause of an unmatched word except names.
 *
 * The fold happens only on the copy handed to the tokenizer. Surfaces are cut
 * from the text as written, so the page still shows the book's own glyph; only
 * the lemma is the folded one, which is what lets 繫ぐ and 繋ぐ be one word.
 *
 * Only pairs where the fold is the same character in another shape. Each target
 * was checked against kuromoji: the folded word is a known IPADIC entry.
 */
const PAIRS = [
  ['繫', '繋'],
  ['摑', '掴'],
  ['吞', '呑'],
  ['搔', '掻'],
  ['啞', '唖'],
  ['剝', '剥'],
  ['嚙', '噛'],
  ['瘦', '痩'],
  ['顚', '顛'],
  ['鹼', '鹸'],
  ['頰', '頬'],
  ['噓', '嘘'],
  ['蟬', '蝉'],
  ['𠮟', '叱'],
  ['醬', '醤'],
  ['蠟', '蝋'],
  ['餠', '餅'],
  ['禱', '祷'],
  ['軀', '躯'],
  ['鷗', '鴎'],
  ['麴', '麹'],
  ['屛', '屏'],
  ['瀆', '涜'],
  ['賤', '賎'],
  ['焰', '焔'],
  ['萊', '莱'],
  ['攪', '撹'],
  ['囊', '嚢'],
  ['簞', '箪'],
  ['繡', '繍'],
  ['塡', '填'],
  ['蠅', '蝿'],
  ['竈', '竃'],
] as const;

const FOLD = new Map<string, string>(PAIRS);

export interface FoldedText {
  /** The text with every variant folded. */
  text: string;
  /**
   * `origin[i]` is the index in the original text of folded index `i`, with one
   * extra entry for the end. Needed because 𠮟 is two UTF-16 units and 叱 one, so
   * a fold can shorten the text; every other pair is one unit to one.
   */
  origin: number[];
}

export function foldVariants(text: string): FoldedText {
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const char of text) {
    const target = FOLD.get(char) ?? char;
    for (let unit = 0; unit < target.length; unit++) origin.push(index);
    folded += target;
    index += char.length;
  }
  origin.push(index);
  return { text: folded, origin };
}
