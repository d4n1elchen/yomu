---
paths:
  - "**/*.test.ts"
---

# Test conventions

Node's built-in runner, no framework: `node:test` + `node:assert/strict`, files
colocated as `*.test.ts`. Run the suite with `npm test` (the glob must stay
quoted so Node expands it, not the shell).

**Database tests must set `YOMU_DB_PATH` to a temp dir _before_ importing the db
client**, which resolves its path at module load. That means `await import(...)`
after setting the env var, not a top-level static import.

**Call `sqlite.close()` before deleting the temp dir** — Windows will not unlink
a database file while the handle is open, and the test fails in cleanup with
EPERM after every assertion has already passed.

**Do not write tests that call the LLM.** They are slow and non-deterministic.
Prompt construction is pure and tested directly in `src/lib/qa/prompt.test.ts`.
