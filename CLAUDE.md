# Yomu

An LLM-assisted Japanese article reader: you read Japanese, the app explains it.

**All user-facing text is Traditional Chinese (Taiwan usage)** — interface
chrome and explanations alike. Never Simplified, never English. The only
Japanese on screen is the material being studied: article text, dictionary
headwords, readings, and inflected forms.

**Library** is the list of articles. **Dictionary** is vocabulary. Never
"lesson" — this is an article reader.

The analyzer owns segmentation, readings, and dictionary forms. The LLM owns
grammar and nuance, and is **never asked for a reading** — every model tested
invents them.

## Code style

- Explicit `.ts` extensions on imports, so Node and the bundler both resolve.
- Node runs TypeScript in strip-only mode: no parameter properties, no enums,
  no namespaces. `erasableSyntaxOnly` catches these at typecheck.
- Tests are `node:test` + `node:assert/strict`, colocated as `*.test.ts`.
- No CSS framework. One `src/app/globals.css`, custom properties, and a
  `prefers-color-scheme` dark block.

## Working here

- Run `npm test` and `npx tsc --noEmit` before reporting work as done.
- `npm run build` kills a running dev server; restart it afterwards.
- `docs/PLAN.md` carries what is decided but not yet built, and why. Read it
  before starting a phase. Do not `@`-import it here — that would load the
  whole plan into every session.
- Decisions made in conversation leave this file quietly wrong, and a stale
  instruction reads exactly like a current one. When a name or a design
  changes, re-read it.
