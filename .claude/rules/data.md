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

# Extending the schema

Hard-vocab marking, quiz scheduling, the dictionary tables, and the sentence
editor all have shapes worked out — read the comment block at the bottom of
`src/db/schema.ts` before designing any of them.

**Grammar is the exception: deliberately undecided.** An earlier design had
entries created during Q&A with the model judging novelty, which does not work
— vocabulary dedups on a natural key the analyzer derives mechanically, while a
model inventing names produces near-duplicates. Grammar needs its own natural
key first. The schema comment explains the two candidates; do not design around
either without deciding.

# Naming trap

`src/lib/library.ts` predates the naming decision and is the **Dictionary** read
model, not the article list. Renaming it is part of the UI restructure.
