/**
 * Rebuilds the sentences and tokens of every section whose token offsets no
 * longer select their own surfaces, from the section's stored source text.
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
import { misalignedSections, retokenizeSection } from '../src/lib/import/retokenize.ts';
import { eq } from 'drizzle-orm';

const check = process.argv.includes('--check');

const found = misalignedSections();
process.stdout.write(`${found.length} misaligned section(s)\n`);

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

if (!check && misalignedSections().length > 0) {
  process.stdout.write('Some sections are still misaligned after rebuilding.\n');
  process.exitCode = 1;
}
sqlite.close();
