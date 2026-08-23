/**
 * IPADIC names its parts of speech in Japanese, and most of those names are
 * written the same way in Chinese. The ones that are not (連体詞, 接続詞,
 * 感動詞, フィラー) would otherwise be the only Japanese grammar vocabulary on
 * screen -- and the interface is meant to be Chinese wherever it is the app
 * talking rather than the material being studied.
 *
 * Anything unmapped falls through unchanged: a new analyzer tag should show up
 * as itself rather than disappear.
 */
const LABELS: Record<string, string> = {
  名詞: '名詞',
  動詞: '動詞',
  形容詞: '形容詞',
  副詞: '副詞',
  助詞: '助詞',
  助動詞: '助動詞',
  連体詞: '連體詞',
  接続詞: '連接詞',
  感動詞: '感嘆詞',
  接頭詞: '接頭詞',
  記号: '符號',
  フィラー: '填充詞',
  その他: '其他',
};

export function posLabel(pos: string): string {
  return LABELS[pos] ?? pos;
}
