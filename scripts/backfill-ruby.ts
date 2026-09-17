/**
 * Gives a book imported before ruby was kept its ruby back, from the EPUB file.
 *
 * Run: npm run db:backfill-ruby -- path/to/book.epub          (rewrites)
 *      npm run db:backfill-ruby -- path/to/book.epub --check  (reports only)
 *
 * The book is found by title. Each chapter the file yields is matched to a
 * stored section by its text: the stored `sourceText` is the file's text with
 * the ruby removed, so a match is exact or it is not the same section. A matched
 * section gets the marked-up text as its source and is rebuilt from it, which
 * keeps the section row, its read stamp and its bookmark -- no re-import.
 *
 * Sections that do not match are listed and left alone: a book re-split into
 * parts since, or a file that is not quite the one imported.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { db, sqlite } from '../src/db/client.ts';
import { sections, works } from '../src/db/schema.ts';
import { parseEpub, type EpubSection } from '../src/lib/epub/epub.ts';
import { retokenizeSection } from '../src/lib/import/retokenize.ts';
import { extractRuby } from '../src/lib/text/ruby.ts';

const file = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const check = process.argv.includes('--check');
if (!file) {
  process.stderr.write('usage: npm run db:backfill-ruby -- path/to/book.epub [--check]\n');
  process.exit(2);
}

const book = parseEpub(readFileSync(file));
const work = db.select().from(works).where(eq(works.title, book.title)).get();
if (!work) {
  process.stderr.write(`No work titled ${JSON.stringify(book.title)} in the Library.\n`);
  process.exit(1);
}

// What the file holds, keyed on the text as it was stored before ruby was kept.
const leaves = (list: EpubSection[]): EpubSection[] =>
  list.flatMap((section) => (section.parts ? section.parts : [section]));
const byText = new Map<string, string>();
for (const section of leaves(book.sections)) {
  byText.set(extractRuby(section.body).text, section.body);
}

const stored = db
  .select({ id: sections.id, title: sections.title, sourceText: sections.sourceText })
  .from(sections)
  .where(and(eq(sections.workId, work.id), isNotNull(sections.sourceText)))
  .orderBy(sections.orderIndex)
  .all();

let rebuilt = 0;
for (const section of stored) {
  const label = section.title ?? '(untitled)';
  // Keyed on the prose, so a section already given its ruby still matches and
  // reads as unchanged -- running this twice is harmless.
  const marked = byText.get(extractRuby(section.sourceText!).text);
  if (marked === undefined) {
    process.stdout.write(`  no match: ${label}\n`);
    continue;
  }
  const count = extractRuby(marked).spans.length;
  if (marked === section.sourceText) {
    process.stdout.write(`  unchanged: ${label}\n`);
    continue;
  }
  if (check) {
    process.stdout.write(`  would add ${count} ruby: ${label}\n`);
    continue;
  }
  db.update(sections).set({ sourceText: marked }).where(eq(sections.id, section.id)).run();
  await retokenizeSection(section.id);
  rebuilt += 1;
  process.stdout.write(`  added ${count} ruby: ${label}\n`);
}

process.stdout.write(`${rebuilt} of ${stored.length} sections rebuilt\n`);
sqlite.close();
