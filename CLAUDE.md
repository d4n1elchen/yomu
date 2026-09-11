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
- No Markdown library. The Q&A answer is rendered by a hand-written subset
  parser (`src/lib/markdown.ts`): bullets, numbered lists, headings, bold,
  code. It must keep parsing **partial** input, because answers stream. Adding
  remark for this would be thirty packages for four constructs.
- No zip or XML library. An EPUB is a ZIP, and `zlib.inflateRawSync` is the
  only hard part of reading one, so `src/lib/epub/zip.ts` parses the central
  directory itself and `xhtml.ts` handles the four constructs that matter
  (ruby, breaks, block ends, entities). Fixtures are built in `fixture.ts`,
  never committed — the real files are copyrighted books.
- No CSS framework. One `src/app/globals.css`, custom properties, one light
  palette taken from the design mock. **No dark mode** — the warm paper ground
  is the design, and `color-scheme: light` keeps a dark-set OS from painting
  form controls and scrollbars out from under it.

## Working here

- Run `npm test` and `npx tsc --noEmit` before reporting work as done.
- JMdict lives in a gitignored `data/`. A fresh clone needs `npm run
  data:jmdict` then `npm run db:jmdict` before the reader can mark hard words;
  without it the difficulty slider hides itself rather than marking everything.
- `npm run build` kills a running dev server; restart it afterwards.
- `npm run deploy` installs a **systemd user service** and restarts it. It runs
  on the machine that serves the app, from a checkout there — the database is a
  local file and the analyzer reads its dictionary off disk, so there is nothing
  to push. `scripts/deploy.sh --print-unit` shows the unit it would write.
- `npm run update` fetches, fast-forwards and redeploys on that same machine.
  It refuses a dirty, diverged or ahead-of-upstream checkout rather than
  merging. `--check` reports what would be pulled without touching anything.
- `docs/PLAN.md` carries what is decided but not yet built, and why. Read it
  before starting a phase, **and again at the end of every chunk of work** —
  nothing else checks it, so it is the one file that goes stale silently while
  the tests still pass. A phase can invalidate its own plan section before it
  ships: this one described a fix as "deliberately not built" two commits after
  building it. Record what was decided and what was rejected, with the
  measurement that decided it; delete what shipped. Do not `@`-import it here —
  that would load the whole plan into every session.
- Decisions made in conversation leave this file quietly wrong, and a stale
  instruction reads exactly like a current one. When a name or a design
  changes, re-read it.
