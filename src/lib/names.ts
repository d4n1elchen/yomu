import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import {
  lexemes,
  sections,
  sentences,
  tokens,
  workNames,
  works,
} from '../db/schema.ts';
import { retokenizeSection } from './import/retokenize.ts';
import { NAME_DICTIONARY, rubyReadingOf, type WorkName } from './text/names.ts';
import { extractRuby } from './text/ruby.ts';

/** Long enough for 小笛千遥 and a family name with it; short enough to be a name. */
const MAX_NAME_LENGTH = 16;

/** The names confirmed in a work, as the analyzer applies them. */
export function namesOf(workId: string): WorkName[] {
  return db
    .select({ surface: workNames.surface, reading: workNames.reading })
    .from(workNames)
    .where(eq(workNames.workId, workId))
    .all();
}

/** A work's sections with their prose, markup removed. Headings have none. */
function proseOf(workId: string) {
  return db
    .select({ id: sections.id, sourceText: sections.sourceText })
    .from(sections)
    .where(and(eq(sections.workId, workId), isNotNull(sections.sourceText)))
    .orderBy(asc(sections.orderIndex))
    .all()
    .map((row) => ({ id: row.id, ...extractRuby(row.sourceText!) }));
}

/**
 * Confirms `surface` as a name in the work `sectionId` belongs to, and
 * re-analyses every section of that work that contains it -- so the name is one
 * token everywhere in the book the moment the card closes, not only here.
 *
 * The reading comes from the book's own ruby on any occurrence in the work,
 * first chapter first; a book annotates a name where it first appears, which is
 * rarely the chapter you are in.
 */
export async function addName(sectionId: string, surface: string): Promise<{ sections: number }> {
  const name = surface.trim();
  if (name === '' || name.length > MAX_NAME_LENGTH || /\s/u.test(name)) {
    throw new Error('人名需為一到十六個字，不能包含空白。');
  }
  const section = db
    .select({ workId: sections.workId })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .get();
  if (!section) throw new Error('找不到這個章節。');

  const prose = proseOf(section.workId);
  const containing = prose.filter((part) => part.text.includes(name));
  if (containing.length === 0) throw new Error('文中找不到這個名字。');

  let reading: string | null = null;
  for (const part of prose) {
    reading = rubyReadingOf(part.text, part.spans, name);
    if (reading) break;
  }

  db.insert(workNames)
    .values({ workId: section.workId, surface: name, reading })
    .onConflictDoUpdate({ target: [workNames.workId, workNames.surface], set: { reading } })
    .run();

  for (const part of containing) await retokenizeSection(part.id);
  return { sections: containing.length };
}

/**
 * Takes a name back out of every work it was confirmed in, and re-analyses the
 * sections that held it, so its pieces are words again. Given the name's lexeme,
 * since that is the row the Dictionary lists.
 */
export async function removeName(lexemeId: string): Promise<void> {
  const lexeme = db
    .select({ lemma: lexemes.lemma, dictionary: lexemes.dictionary })
    .from(lexemes)
    .where(eq(lexemes.id, lexemeId))
    .get();
  if (!lexeme || lexeme.dictionary !== NAME_DICTIONARY) return;

  const held = db
    .select({ workId: workNames.workId })
    .from(workNames)
    .where(eq(workNames.surface, lexeme.lemma))
    .all()
    .map((row) => row.workId);
  if (held.length === 0) return;

  db.delete(workNames)
    .where(and(eq(workNames.surface, lexeme.lemma), inArray(workNames.workId, held)))
    .run();

  for (const workId of held) {
    for (const part of proseOf(workId)) {
      if (part.text.includes(lexeme.lemma)) await retokenizeSection(part.id);
    }
  }
}

export interface NameEntry {
  lexemeId: string;
  surface: string;
  /** Katakana, like every lexeme reading; empty when the book gave none. */
  reading: string;
  occurrences: number;
  workTitles: string[];
}

/** Every confirmed name that occurs somewhere, commonest first. */
export function listNames(): NameEntry[] {
  const rows = db
    .select({
      lexemeId: lexemes.id,
      surface: lexemes.lemma,
      reading: lexemes.reading,
      occurrences: sql<number>`count(${tokens.id})`,
      workTitles: sql<string>`group_concat(distinct ${works.title})`,
    })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .innerJoin(sections, eq(sections.id, sentences.sectionId))
    .innerJoin(works, eq(works.id, sections.workId))
    .where(eq(lexemes.dictionary, NAME_DICTIONARY))
    .groupBy(lexemes.id)
    .orderBy(sql`count(${tokens.id}) desc`)
    .all();
  // group_concat joins with a comma, and a title may hold one; titles are only
  // shown, never parsed back into ids, so a mis-split costs a label.
  return rows.map((row) => ({ ...row, workTitles: row.workTitles.split(',') }));
}
