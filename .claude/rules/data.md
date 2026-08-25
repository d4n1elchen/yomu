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

**Grammar is the exception: deliberately undecided.** An earlier design had
entries created during Q&A with the model judging novelty, which does not work
— vocabulary dedups on a natural key the analyzer derives mechanically, while a
model inventing names produces near-duplicates. Grammar needs its own natural
key first. The schema comment explains the two candidates; do not design around
either without deciding.

# Naming

**Library** is the list of articles (`src/lib/article.ts`, `/library`).
**Dictionary** is vocabulary (`src/lib/dictionary.ts`, `/dictionary`). Never
"lesson" — this is an article reader.

`article.ts` counts a work's vocabulary with `contentWord` exported from
`dictionary.ts`, so the tally on a Library row and the words the Dictionary
lists can never disagree.
