/**
 * Rebuilds the sentences and tokens of every section whose token offsets no
 * longer select their own surfaces, or that an older analyzer version wrote,
 * from the section's stored source text.
 *
 * Run: npm run db:retokenize          (repairs)
 *      npm run db:retokenize -- --check (lists, changes nothing)
 *
 * Written for the imports made before the analyzer stopped trusting kuromoji's
 * `word_position`, which drifted a character at every grouped 〟。. Safe to run
 * again: a healthy database has nothing to repair.
 */

import { sqlite, db } from '../src/db/client.ts';
import { sections, works } from '../src/db/schema.ts';
import {
  misalignedSections,
  retokenizeSection,
  staleSections,
} from '../src/lib/import/retokenize.ts';
import { eq } from 'drizzle-orm';

const check = process.argv.includes('--check');

const misaligned = misalignedSections();
const stale = staleSections();
const found = [...new Set([...misaligned, ...stale])];
process.stdout.write(
  `${misaligned.length} misaligned, ${stale.length} from an older analyzer\n`,
);

for (const sectionId of found) {
  const row = db
    .select({ work: works.title, section: sections.title })
    .from(sections)
    .innerJoin(works, eq(works.id, sections.workId))
    .where(eq(sections.id, sectionId))
    .get();
  const label = `${row?.work ?? '?'} / ${row?.section ?? '(untitled)'} [${sectionId}]`;
  if (check) {
    process.stdout.write(`  ${label}\n`);
    continue;
  }
  await retokenizeSection(sectionId);
  process.stdout.write(`  rebuilt ${label}\n`);
}

if (!check && misalignedSections().length + staleSections().length > 0) {
  process.stdout.write('Some sections are still misaligned or stale after rebuilding.\n');
  process.exitCode = 1;
}
sqlite.close();
