---
paths:
  - "next.config.ts"
  - "src/app/**"
  - "src/components/**"
---

# Next.js configuration traps

Both of these present as broken application code when they are actually config.

**`serverExternalPackages`** must list any package that reads files out of
`node_modules` or loads a native binding — currently `kuromoji`, `kuromojin`,
`better-sqlite3`. Resolve such a package's path from `process.cwd()`, never from
`import.meta.url`: Turbopack rewrites module URLs for externalized packages to a
virtual `[externals]/…` path, and resolving against one produces a directory
that does not exist. Symptom is a confusing ENOENT deep inside the library.

**`allowedDevOrigins`** needs any non-`localhost` host used in dev (the LAN IP,
`127.0.0.1`). Without it Next returns 403 for its own client chunks, so the page
server-renders fine but never hydrates — nothing is clickable and there are no
console errors. It looks exactly like broken React.

**Sentences render with `id={`sentence-${id}`}`.** Library occurrence links and
Q&A selection both target it; keep the id stable.

**Furigana alignment is computed at render time, never stored.** It is a pure
function of `(surface, reading)`, so the aligner can be fixed without a
migration — and it will need fixing.
