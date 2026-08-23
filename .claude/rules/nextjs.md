---
paths:
  - "next.config.ts"
  - "src/app/**"
  - "src/components/**"
---

# Next.js configuration traps

Both of these present as broken application code when they are actually config.

**`serverExternalPackages`** must list any package that reads files out of
`node_modules` or loads a native binding — currently `kuromoji` and
`better-sqlite3`. Resolve such a package's path from `process.cwd()`, never from
`import.meta.url`: Turbopack rewrites module URLs for externalized packages to a
virtual `[externals]/…` path, and resolving against one produces a directory
that does not exist. Symptom is a confusing ENOENT deep inside the library.

**`allowedDevOrigins`** needs any non-`localhost` host used in dev (the LAN IP,
`127.0.0.1`). Without it Next returns 403 for its own client chunks, so the page
server-renders fine but never hydrates — nothing is clickable and there are no
console errors. It looks exactly like broken React.

The value comes from `YOMU_DEV_ORIGIN` in `.env.local`, never from committed
config. **That file must be UTF-8.** Next parses `.env` files as UTF-8, so a
UTF-16 one — which is what PowerShell's `>` and `Set-Content` write by default
— yields mojibake keys and is ignored without a word, leaving every variable in
it undefined while the file looks perfectly correct in an editor.

**Sentences render with `id={`sentence-${id}`}`.** Dictionary occurrence links
target it; keep the id stable. Selection-based Q&A instead reads the
`data-sentence` / `data-start` / `data-end` attributes on each token span,
which is what maps a browser selection back onto our sentence-relative
offsets; those attributes are load-bearing too.

**Furigana alignment is computed at render time, never stored.** It is a pure
function of `(surface, reading)`, so the aligner can be fixed without a
migration — and it will need fixing.
