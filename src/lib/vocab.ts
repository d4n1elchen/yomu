import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.ts';
import { lexemes, userLexemeState } from '../db/schema.ts';

/**
 * 生詞 -- the words you have picked out of the marked ones to learn.
 *
 * Separate from marking on purpose. The dashed underline is statistical and says
 * "JMdict does not call this common"; this list is yours and says "I do not know
 * this yet". Keeping them apart is what lets a marked word stay marked after you
 * pick it, which in turn is what makes picking reversible in place.
 *
 * Everything here resolves across the Dictionary's group rather than the bare
 * lexeme, because 見る and 観る are one row in the Dictionary and would look
 * broken as two states. The grouping expression is `coalesce(dictEntryId, id)`,
 * the same one `wordGroup` uses -- a word that matched nothing falls back to
 * standing alone, keyed on itself.
 */

/** The Dictionary's grouping, as it applies to one lexeme row. */
const group = sql`coalesce(${lexemes.dictEntryId}, ${lexemes.id})`;

/** Every lexeme filed under the same Dictionary row as this one. */
function groupMembers(lexemeId: string): string[] {
  return db
    .select({ id: lexemes.id })
    .from(lexemes)
    .where(
      sql`${group} = (
        select coalesce(dict_entry_id, id) from ${lexemes} where id = ${lexemeId}
      )`,
    )
    .all()
    .map((row) => row.id);
}

/**
 * Whether a word is on the list, asked of any lexeme in its group.
 *
 * Marking writes one row and unmarking clears the whole group, so in practice
 * only one member carries it -- but reading has to accept any of them, or a
 * second spelling encountered later would read as unmarked.
 */
export function isLearning(lexemeId: string): boolean {
  const members = groupMembers(lexemeId);
  if (members.length === 0) return false;
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(userLexemeState)
      .where(sql`${userLexemeState.lexemeId} in ${members}`)
      .get()!.n > 0
  );
}

/**
 * Adds or removes a word.
 *
 * Adding writes a single row against the lexeme you actually met, which is the
 * honest record of where it came from. Removing clears every member of the
 * group, or the word would still read as marked through a spelling you never
 * touched.
 */
export function setLearning(lexemeId: string, learning: boolean): void {
  db.transaction((tx) => {
    if (!learning) {
      const members = groupMembers(lexemeId);
      if (members.length > 0) {
        tx.delete(userLexemeState)
          .where(sql`${userLexemeState.lexemeId} in ${members}`)
          .run();
      }
      return;
    }
    tx.insert(userLexemeState)
      .values({ lexemeId })
      .onConflictDoNothing()
      .run();
  });
}

/**
 * The group keys currently on the list -- what the reader needs to render, in
 * one query rather than one per word.
 *
 * Group keys rather than lexeme ids, so the caller can ask about a token with
 * `entryId ?? lexemeId` and get the same answer the Dictionary would give.
 */
export function learningGroupKeys(): string[] {
  return db
    .select({ key: sql<string>`${group}` })
    .from(userLexemeState)
    .innerJoin(lexemes, eq(lexemes.id, userLexemeState.lexemeId))
    .all()
    .map((row) => row.key);
}

/** How many distinct words are on the list. */
export function learningCount(): number {
  return new Set(learningGroupKeys()).size;
}
