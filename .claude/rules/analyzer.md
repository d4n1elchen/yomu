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
so segmentation still sees the sentence end. An unknown token that is only
marks (`!!」`, `〝`) is split per character and filed as 記号, or a quote ending
in `!!` never closes. Sections imported before a segmentation change are found
and rebuilt by `npm run db:retokenize` — **bump `version` in `kuromoji.ts`
whenever stored text would now segment differently**, since that is how it
finds them.

**IPADIC predates the 2004 print forms** (繫 摑 吞 搔 𠮟…), and splits every word
written with one. `src/lib/text/variants.ts` folds them on the copy handed to
the tokenizer only: surfaces stay as written, lemmas are the folded spelling.
𠮟 is two UTF-16 units and 叱 one, so offsets go through the fold's `origin` map.

**IPADIC has no reading for many proper nouns**, and splits names (綾辻 becomes
綾 + 辻). Carry `reading: null` through honestly rather than faking one; the UI
handles its absence.

**Sentence segmentation runs over the token stream, not the raw string.**
Splitting on 。 breaks on 「」 dialogue, ……, and Latin `. `. Quote depth is what
keeps 「面白い！」と言った。 one sentence.
