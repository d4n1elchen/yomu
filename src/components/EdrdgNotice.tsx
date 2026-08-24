/**
 * JMdict's licence is Creative Commons Attribution-ShareAlike, and the
 * attribution is a condition of using the data rather than a courtesy. It names
 * the group, not just the file, which is what the licence asks for.
 *
 * One component so the wording cannot drift between the two Dictionary pages.
 */
export function EdrdgNotice() {
  return (
    <p className="edrdg">
      釋義來自{' '}
      <a href="https://www.edrdg.org/jmdict/j_jmdict.html">JMdict</a>，©{' '}
      Electronic Dictionary Research and Development Group，依{' '}
      <a href="https://www.edrdg.org/edrdg/licence.html">CC BY-SA</a> 授權使用。
    </p>
  );
}
