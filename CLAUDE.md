# Yomu

**All user-facing text is Traditional Chinese (Taiwan usage)** — interface
chrome and explanations alike. Never Simplified, never English.

The only Japanese on screen is the material being studied: article text,
dictionary headwords, readings, and inflected forms.

## Division of labour

The morphological analyzer owns segmentation, readings, and dictionary forms.
The LLM owns grammar and nuance, and is **never asked for a reading** — every
model tested invents them. Prompts hand it the analyzer's output as fact.

## Data invariants

Breaking these fails silently, and each one is load-bearing for the Library.

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
- `needsReview` gates the Library. Transcription errors tokenize as cleanly as
  real Japanese; new Library queries must keep the filter.

## Conventions

- Explicit `.ts` extensions on imports, so Node and the bundler both resolve.
- Node runs TypeScript in strip-only mode: no parameter properties, no enums,
  no namespaces. `erasableSyntaxOnly` catches these at typecheck.
- Tests are `node:test` + `node:assert/strict`, colocated as `*.test.ts`.
- No CSS framework. One `src/app/globals.css`, custom properties, and a
  `prefers-color-scheme` dark block.
- Run `npm test` and `npx tsc --noEmit` before reporting work as done.
- `npm run build` kills a running dev server; restart it afterwards.

## Extending the schema

Grammar entries, hard-vocab marking, quiz scheduling, and the sentence editor
all have shapes already worked out — read the comment block at the bottom of
`src/db/schema.ts` before designing any of them.
