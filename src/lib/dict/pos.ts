/**
 * Translating IPADIC's grammar vocabulary into JMdict's.
 *
 * The two describe the same language with different tagsets, and neither is a
 * subset of the other. This is not a full mapping and does not try to be -- it
 * exists to answer one question during matching: *of the entries sharing this
 * lemma and reading, which ones could grammatically be this token?*
 *
 * That question is what separates 居る from 入る. Both are いる, both are flagged
 * common, neither is ranked, so nothing else in the data can tell them apart --
 * but IPADIC says the token conjugates 一段 and JMdict says 居る is `v1` while
 * 入る is `v5r`, and those cannot both be true of one word.
 *
 * An empty result means "no opinion", and the caller must not filter on it.
 * Being silent is always safe here; being wrong is not.
 */

export interface AnalyzerPos {
  /** IPADIC's coarse part of speech: 動詞, 名詞, 連体詞... */
  pos: string;
  /** `pos_detail_1`: 接尾, 数, 代名詞, 自立... Null when the analyzer had none. */
  posDetail: string | null;
  /** `conjugated_type`: 一段, 五段・ラ行, サ変・スル... Null for uninflected words. */
  conjugationType: string | null;
}

/**
 * Conjugation class is the sharpest signal IPADIC gives, because JMdict encodes
 * the same distinction in its verb tags. Matched by prefix: IPADIC splits
 * 五段・カ行 into イ音便 and 促音便 variants that JMdict does not distinguish.
 */
const CONJUGATION: Array<[string, string[]]> = [
  ['一段', ['v1', 'v1-s']],
  ['五段・カ行促音便ユク', ['v5k-s']],
  ['五段・カ行', ['v5k', 'v5k-s']],
  ['五段・ガ行', ['v5g']],
  ['五段・サ行', ['v5s']],
  ['五段・タ行', ['v5t']],
  ['五段・ナ行', ['v5n']],
  ['五段・バ行', ['v5b']],
  ['五段・マ行', ['v5m']],
  ['五段・ラ行特殊', ['v5aru', 'v5r', 'v5r-i']],
  ['五段・ラ行', ['v5r', 'v5r-i', 'v5aru']],
  ['五段・ワ行', ['v5u', 'v5u-s']],
  ['カ変', ['vk']],
  ['サ変・−ズル', ['vz']],
  ['サ変', ['vs', 'vs-i', 'vs-s']],
  ['形容詞', ['adj-i', 'adj-ix']],
];

/** Noun subtypes JMdict tags distinctly. Anything else is a plain noun. */
const NOUN_DETAIL: Record<string, string[]> = {
  数: ['num', 'ctr'],
  代名詞: ['pn'],
  接尾: ['suf', 'n-suf', 'ctr'],
  形容動詞語幹: ['adj-na', 'adj-no'],
  サ変接続: ['n', 'vs', 'adj-no'],
  副詞可能: ['n', 'adv', 'n-adv', 'n-t'],
};

const NOUN = ['n', 'n-adv', 'n-t', 'n-pref', 'n-suf', 'adj-no', 'pn'];

const COARSE: Record<string, string[]> = {
  名詞: NOUN,
  形容詞: ['adj-i', 'adj-ix'],
  副詞: ['adv', 'adv-to', 'n-adv'],
  連体詞: ['adj-pn'],
  接続詞: ['conj'],
  感動詞: ['int'],
  接頭詞: ['pref', 'n-pref'],
  助詞: ['prt'],
  助動詞: ['aux-v', 'aux', 'aux-adj', 'cop'],
};

/**
 * The JMdict part-of-speech tags a token could plausibly carry, or `[]` when
 * IPADIC's answer does not narrow anything down.
 */
export function jmdictTags(analyzer: AnalyzerPos): string[] {
  const { pos, posDetail, conjugationType } = analyzer;

  // A verb's conjugation class outranks everything else, and 助動詞 like だ or
  // 形容詞 carry one too -- but only trust it where JMdict makes the same
  // distinction. IPADIC's 特殊・タ, 不変化型 and 文語・* have no counterpart.
  if (conjugationType) {
    for (const [prefix, tags] of CONJUGATION) {
      if (conjugationType.startsWith(prefix)) return tags;
    }
  }

  if (pos === '名詞' && posDetail) {
    const detail = NOUN_DETAIL[posDetail];
    if (detail) return detail;
  }

  return COARSE[pos] ?? [];
}

/**
 * Whether an entry could grammatically be this token.
 *
 * True when nothing narrows it down, so that a word IPADIC has no useful tag
 * for is never dropped for failing a test that was never applied. Matching
 * coverage must not regress in exchange for sharper disambiguation.
 */
export function posAgrees(analyzer: AnalyzerPos, entryTags: Iterable<string>): boolean {
  const allowed = jmdictTags(analyzer);
  if (allowed.length === 0) return true;

  const wanted = new Set(allowed);
  for (const tag of entryTags) {
    if (wanted.has(tag)) return true;
  }
  return false;
}
