import { eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { sections } from '../../db/schema.ts';
import { resolveSectionAmbiguity } from '../dict/resolve.ts';
import { translatePending } from '../translate/translate.ts';

/**
 * The background analysis drain.
 *
 * Both model passes live behind one entry point, because both are resumable work
 * against a queue that is derived rather than stored -- resolution's queue is
 * `dictMatch = 'lemma_reading_multi' and dictResolver is null`, translation's is
 * `glossZh is null`. Neither needs a job table; what they needed was a trigger
 * that is not "the request that happened to create the article".
 *
 * Order matters. Resolution runs first and to completion, because it moves
 * `lexeme.dictEntryId` and a section is not readable until it has settled.
 * Translation only fills `glossZh`, so it can run for as long as it likes with
 * nothing waiting on it.
 */

/**
 * One drain at a time. A module-level flag is enough and a lock table would be
 * wrong: better-sqlite3 is one synchronous connection in one process, so there
 * is no second worker to coordinate with. The writes are individually safe
 * anyway -- `writeTranslations` fills only rows still null -- so this exists to
 * avoid asking the model the same question twice, not to protect the data.
 */
let running = false;

/**
 * When the host was last found unreachable. Without this, every Library visit
 * with Ollama down would fire a fresh round of connection attempts; reading the
 * Library must not cost anything when there is no model to talk to.
 */
let unreachableSince = 0;
const BACKOFF_MS = 2 * 60 * 1000;

/** Sections whose resolution has not finished. */
function pendingSections(): string[] {
  return db
    .select({ id: sections.id })
    .from(sections)
    .where(isNull(sections.resolvedAt))
    .orderBy(sections.orderIndex)
    .all()
    .map((row) => row.id);
}

/**
 * Runs both passes over everything outstanding, whatever import left it behind.
 *
 * Whole-database scope on purpose. Scoping to the work being imported was the
 * bug in the first cut: a lexeme left unresolved by one article was never
 * revisited unless a later article happened to contain it too.
 *
 * Returns immediately when a drain is already in flight or the host was just
 * found down, so callers may fire it as often as they like.
 */
export async function ensureDraining(): Promise<void> {
  if (running) return;
  if (unreachableSince && Date.now() - unreachableSince < BACKOFF_MS) return;

  running = true;
  try {
    // Resolution first, and per section, so a section becomes readable as soon
    // as its own ambiguity is settled rather than waiting on the whole backlog.
    for (const sectionId of pendingSections()) {
      if (!(await resolveSectionAmbiguity(sectionId))) {
        unreachableSince = Date.now();
        return;
      }
    }

    const reached = await translatePending();
    unreachableSince = reached ? 0 : Date.now();
  } finally {
    running = false;
  }
}

/** Whether a section is readable yet. */
export function isReadable(sectionId: string): boolean {
  const row = db
    .select({ resolvedAt: sections.resolvedAt })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .get();
  return row?.resolvedAt != null;
}
