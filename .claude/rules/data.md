---
paths:
  - "src/db/**"
  - "src/lib/import/**"
  - "src/lib/*.ts"
---

# Data invariants

Breaking these fails silently, and each one is load-bearing for the Dictionary.

- Token offsets are relative to `sentence.text`, never to the section.
  `sentence.text.slice(token.charStart, token.charEnd) === token.surface`
  must hold for every row.
- `writeSentenceTokens` in `src/lib/import/tokens.ts` is the only place token
  rows are written. Do not add a second writer.
- A vocab occurrence *is* the `token` row. Never add a vocab occurrence table.
- `lexeme` identity is `(dictionary, lemma, reading, pos)` where `reading` is
  the reading of the **lemma**, not the surface. Using the surface reading files
  every inflection separately and defeats the grouping.
- Q&A is ephemeral: it streams an answer and stores nothing. Anything that
  anchors into a sentence later must carry `sentenceRevision`, so an edit marks
  it stale rather than silently mis-positioning it.
- Never garbage-collect orphaned lexemes — the user may have learned the word.
  Deleting an article (`deleteWork`) is the main producer of them: it cascades
  through sections, sentences and tokens and stops there, on purpose.
- `needsReview` gates the Dictionary. Transcription errors tokenize as cleanly
  as real Japanese; new Dictionary queries must keep the filter.
- **Underlining is statistical only.** `isHardWord` reads JMdict, never user
  state. The 生詞 list (`user_lexeme_state`) is a separate axis and must not feed
  back into it -- a marked word stays marked after you pick it, which is what
  keeps picking reversible in the reader.
- User state is keyed on `lexeme` but read across the Dictionary's group,
  `coalesce(dict_entry_id, lexeme.id)`. Adding writes one row; removing must
  clear every member of the group.
- A word is hard when `isHardWord` in `src/lib/marking.ts` says so, and that
  needs **both** `freqBand` and `common`. The band alone treats every word the
  newspaper corpus never ranked — 本 among them — as rarer than the 24,000th.

# Extending the schema

Hard-vocab marking, quiz scheduling, and the sentence editor all have shapes
worked out — read the comment block at the bottom of `src/db/schema.ts` before
designing any of them. The dictionary tables are built; `dict_form` exists so
that matching a lexeme is an indexed query rather than a pass over the 118 MB
source file, which an article import must not need on disk.

**Grammar is keyed on つつじ's L2 id**, matched over one sentence's tokens
when you ask about it, with the model choosing among the matches and never
naming, and nothing stored until you add a card. `docs/PLAN.md` ("Grammar —
built") has the design and the measurements.

- **Never give `user_grammar_state` or `grammar_occurrence` a foreign key to
  `grammar_point`.** `db:tsutsuji` rebuilds that table, and a cascade would
  empty the reader's 文法庫 on every re-import. The id is a natural key and
  rejoins afterwards; a test holds this.
- **A kept point's id must come from the inventory.** `keepGrammarPoint`
  refuses anything else, which is what stops a model-named entry getting in.
- **`grammar_analysis` is a cache, never a record.** It holds what the card
  last found in a sentence so reopening is instant; deleting every row loses
  nothing. Keep names and glosses out of it (they are joined in when read), and
  never let it feed `user_grammar_state` or `grammar_occurrence`.
- **Reviewed glosses live in `src/lib/grammar/reviewed-glosses.json`**, applied
  last by the import. Correct a gloss there, not in the database, or the next
  import undoes it.

# Naming

**Library** is the list of articles (`src/lib/article.ts`, `/library`).
**Dictionary** is vocabulary (`src/lib/dictionary.ts`, `/dictionary`). Never
"lesson" — this is an article reader.

`article.ts` counts a work's vocabulary with `contentWord` exported from
`dictionary.ts`, so the tally on a Library row and the words the Dictionary
lists can never disagree.
