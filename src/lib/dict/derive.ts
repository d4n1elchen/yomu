import type { AnalyzerPos } from './pos.ts';

/** A spelling to look up in place of the analyzer's lemma, and what it must be. */
export interface DerivedForm {
  lemma: string;
  /** Katakana, like the analyzer's; empty when the analyzer gave none. */
  reading: string;
  /** JMdict tags the matched entry must carry -- the rewrite's whole claim. */
  tags: string[];
}

/**
 * The potential ending, e-row + る, back to the godan verb it came from.
 * Keyed on the kana before る in both scripts, since the lemma is hiragana and
 * the reading katakana.
 */
const POTENTIAL: Record<string, { plain: string; tags: string[] }> = {
  え: { plain: 'う', tags: ['v5u', 'v5u-s'] },
  け: { plain: 'く', tags: ['v5k', 'v5k-s'] },
  げ: { plain: 'ぐ', tags: ['v5g'] },
  せ: { plain: 'す', tags: ['v5s'] },
  て: { plain: 'つ', tags: ['v5t'] },
  ね: { plain: 'ぬ', tags: ['v5n'] },
  べ: { plain: 'ぶ', tags: ['v5b'] },
  め: { plain: 'む', tags: ['v5m'] },
  れ: { plain: 'る', tags: ['v5r', 'v5r-i', 'v5aru'] },
  エ: { plain: 'ウ', tags: [] },
  ケ: { plain: 'ク', tags: [] },
  ゲ: { plain: 'グ', tags: [] },
  セ: { plain: 'ス', tags: [] },
  テ: { plain: 'ツ', tags: [] },
  ネ: { plain: 'ヌ', tags: [] },
  ベ: { plain: 'ブ', tags: [] },
  メ: { plain: 'ム', tags: [] },
  レ: { plain: 'ル', tags: [] },
};

/**
 * Rewrites of a lemma JMdict does not list, into the entry it does -- tried only
 * when the lemma as analyzed has matched nothing at all.
 *
 * Each is a mechanical rule against one known class, not a fuzzy lookup, and
 * each names the tags its result must carry. That is the gate the rejected
 * general fallback lacked: 待っ+た rebuilds to 待った "false start", but a
 * potential can only land on a godan verb of the same row.
 *
 * - **Potential verbs.** IPADIC lists 会える, 出せる, 歌える as 一段 verbs of their
 *   own; JMdict has only 会う, 出す, 歌う. The largest class by far, and the
 *   Dictionary then files 会える under 会う, which is the word being learned.
 * - **と-adverbs.** 黙々と, 漠然と -- JMdict lists the stem, tagged `adv-to`.
 * - **ない-adjective stems.** 味気, ぎこち -- JMdict lists 味気ない.
 * - **Classical サ行 verbs.** 発す, 接す, 面す -- JMdict lists 発する.
 */
export function derivedForms(
  lemma: string,
  reading: string,
  analyzer: AnalyzerPos,
): DerivedForm[] {
  const forms: DerivedForm[] = [];
  const { pos, posDetail, conjugationType } = analyzer;

  if (pos === '動詞' && conjugationType?.startsWith('一段') && lemma.endsWith('る')) {
    const row = POTENTIAL[lemma.at(-2) ?? ''];
    if (row && row.tags.length > 0 && lemma.length >= 3) {
      forms.push({
        lemma: lemma.slice(0, -2) + row.plain,
        reading: potentialReading(reading),
        tags: row.tags,
      });
    }
  }

  if (pos === '動詞' && conjugationType?.startsWith('五段・サ行') && lemma.endsWith('す')) {
    forms.push({
      lemma: `${lemma.slice(0, -1)}する`,
      reading: reading.endsWith('ス') ? `${reading.slice(0, -1)}スル` : '',
      tags: ['vs-s', 'vs-i'],
    });
  }

  if (pos === '副詞' && lemma.endsWith('と') && lemma.length >= 3) {
    forms.push({
      lemma: lemma.slice(0, -1),
      reading: reading.endsWith('ト') ? reading.slice(0, -1) : '',
      tags: ['adv-to', 'adv', 'adj-t'],
    });
  }

  if (pos === '名詞' && posDetail === 'ナイ形容詞語幹') {
    forms.push({
      lemma: `${lemma}ない`,
      reading: reading === '' ? '' : `${reading}ナイ`,
      tags: ['adj-i'],
    });
  }

  return forms;
}

/** ハナセル -> ハナス. Empty when the reading does not have the expected shape. */
function potentialReading(reading: string): string {
  if (!reading.endsWith('ル')) return '';
  const row = POTENTIAL[reading.at(-2) ?? ''];
  return row ? reading.slice(0, -2) + row.plain : '';
}
