---
paths:
  - "src/lib/analyzer/**"
  - "src/lib/text/**"
  - "src/lib/import/**"
---

# Analyzer pitfalls

**Never trust kuromoji's `word_position`.** It counts code points, not UTF-16
units, so one rare kanji (𠮷, 𩸽) or emoji slid every later offset. Worse, the
tokenizer splits its input after each 、 and 。 and places the next piece at the
*start* of the previous piece's last token: when an unknown symbol groups with
the mark (〝補佐〟。 ends in the token 〟。) every later offset in the chapter
comes out a character early. `src/lib/analyzer/kuromoji.ts` places each token
where the previous surface ended, and cuts 、/。 out of grouped unknown tokens
so segmentation still sees the sentence end. Sections imported before that are
found and rebuilt by `npm run db:retokenize`.

**IPADIC has no reading for many proper nouns**, and splits names (綾辻 becomes
綾 + 辻). Carry `reading: null` through honestly rather than faking one; the UI
handles its absence.

**Sentence segmentation runs over the token stream, not the raw string.**
Splitting on 。 breaks on 「」 dialogue, ……, and Latin `. `. Quote depth is what
keeps 「面白い！」と言った。 one sentence.
