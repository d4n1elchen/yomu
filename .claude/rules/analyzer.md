---
paths:
  - "src/lib/analyzer/**"
  - "src/lib/text/**"
  - "src/lib/import/**"
---

# Analyzer pitfalls

**kuromoji reports `word_position` in code points, not UTF-16 units.** One rare
kanji (𠮷, 𩸽) or emoji slides every later offset by one, corrupting sentence
text and word selection for the rest of the document. Handled in
`src/lib/analyzer/kuromoji.ts`. The surrogate guard there deliberately omits the
`/u` flag: in Unicode mode a well-formed pair matches as its combined code
point, so the surrogate range never hits and the check silently does nothing.

**kuromojin latches `isLoading` and never clears it on failure.** One bad
dictionary path leaves it returning the same rejected promise for the life of
the process, and `serverExternalPackages` keeps it in Node's require cache so
HMR will not clear it either. The dictionary path is validated before kuromojin
is called. If tokenization breaks, restart the dev server — retrying cannot work.

**IPADIC has no reading for many proper nouns**, and splits names (綾辻 becomes
綾 + 辻). Carry `reading: null` through honestly rather than faking one; the UI
handles its absence.

**Sentence segmentation runs over the token stream, not the raw string.**
Splitting on 。 breaks on 「」 dialogue, ……, and Latin `. `. Quote depth is what
keeps 「面白い！」と言った。 one sentence.
