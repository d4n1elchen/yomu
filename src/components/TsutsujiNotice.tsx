/**
 * つつじ is CC BY-SA 4.0, and the attribution is a condition of using it, as
 * JMdict's is. It names the authors rather than just the file, which is what
 * the licence asks for; the Chinese names and glosses are derived from it, so
 * they are covered by the same notice.
 *
 * One component so the wording cannot drift between the pages that show grammar.
 */
export function TsutsujiNotice() {
  return (
    <p className="edrdg">
      句型分類來自{' '}
      <a href="https://sites.google.com/edu.teu.ac.jp/cl-lab/%E7%A0%94%E7%A9%B6/%E8%A8%80%E8%AA%9E%E8%B3%87%E6%BA%90/%E6%97%A5%E6%9C%AC%E8%AA%9E%E6%A9%9F%E8%83%BD%E8%A1%A8%E7%8F%BE%E8%BE%9E%E6%9B%B8%E3%81%A4%E3%81%A4%E3%81%98">
        日本語機能表現辞書「つつじ」
      </a>
      ，© 松吉俊、佐藤理史，依{' '}
      <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.zh-hant">CC BY-SA 4.0</a>{' '}
      授權使用；中文說明由此衍生，採相同授權。
    </p>
  );
}
