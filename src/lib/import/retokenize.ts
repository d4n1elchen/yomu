import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sections, sentences, tokens } from '../../db/schema.ts';
import { getAnalyzer } from '../analyzer/index.ts';
import { linkLexemes } from '../dict/match.ts';
import { segmentSentences } from '../text/sentences.ts';
import { writeSentences } from './ingest.ts';
import { LexemeResolver } from './tokens.ts';

/**
 * Sections whose stored tokens break the one invariant the reader relies on:
 * `sentence.text.slice(charStart, charEnd) === surface`.
 *
 * Checked in JavaScript rather than with SQLite's `substr`, which counts code
 * points where the offsets are UTF-16 units -- every astral kanji would be
 * reported as damage.
 *
 * This is what an import before the analyzer placed tokens by their surfaces
 * left behind: kuromoji's positions slid a character per grouped 〟。, so the
 * sentences after one open with the previous mark and every token is off.
 */
export function misalignedSections(): string[] {
  const rows = db
    .select({
      sectionId: sentences.sectionId,
      text: sentences.text,
      surface: tokens.surface,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
    })
    .from(tokens)
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .all();

  const found = new Set<string>();
  for (const row of rows) {
    if (row.text.slice(row.charStart, row.charEnd) !== row.surface) {
      found.add(row.sectionId);
    }
  }
  return [...found];
}

/**
 * Sections an older analyzer wrote: a change to segmentation (2004 print forms
 * folded, marks split out of unknown runs) only reaches stored text when the
 * section is analysed again. Headings carry no source text and are skipped.
 */
export function staleSections(): string[] {
  const { version } = getAnalyzer();
  return db
    .select({ id: sections.id })
    .from(sections)
    .where(and(ne(sections.analyzerVersion, version), isNotNull(sections.sourceText)))
    .all()
    .map((row) => row.id);
}

/** Unresolved ambiguous lexemes among a section's tokens -- the drain's queue. */
function ambiguousIn(sectionId: string): Set<string> {
  const rows = db
    .selectDistinct({ id: lexemes.id })
    .from(lexemes)
    .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
    .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
    .where(
      and(
        eq(sentences.sectionId, sectionId),
        eq(lexemes.dictMatch, 'lemma_reading_multi'),
        isNull(lexemes.dictResolver),
      ),
    )
    .all();
  return new Set(rows.map((r) => r.id));
}

/**
 * Throws a section's sentences and tokens away and derives them again from its
 * `sourceText`, which import stores untouched for exactly this.
 *
 * The section row stays, so its place in the book, its read stamp and its
 * resolution state stay with it. Sentence ids do not survive -- boundaries may
 * move, which is the point -- so the bookmark is carried to whichever new
 * sentence overlaps the old one most.
 *
 * Resolution is reopened only when a lexeme that needs the model is new to the
 * section. Recounting from scratch would grey a settled chapter for candidate
 * sets the resolver already skipped, since skipping leaves no stamp.
 */
export async function retokenizeSection(sectionId: string): Promise<void> {
  const section = db
    .select({
      sourceText: sections.sourceText,
      progressSentenceId: sections.progressSentenceId,
      resolveTotal: sections.resolveTotal,
    })
    .from(sections)
    .where(eq(sections.id, sectionId))
    .get();
  if (!section) throw new Error(`No section ${sectionId}.`);
  const body = section.sourceText;
  if (body === null) throw new Error(`Section ${sectionId} has no source text.`);

  const analyzer = getAnalyzer();
  const segmented = segmentSentences(body, await analyzer.analyze(body));

  const old = db
    .select({ id: sentences.id, text: sentences.text, needsReview: sentences.needsReview })
    .from(sentences)
    .where(eq(sentences.sectionId, sectionId))
    .orderBy(sentences.orderIndex)
    .all();
  const bookmark = locate(body, old, section.progressSentenceId);
  const before = ambiguousIn(sectionId);

  db.transaction((tx) => {
    // Tokens go with their sentences by cascade.
    tx.delete(sentences).where(eq(sentences.sectionId, sectionId)).run();

    const ids = writeSentences(tx, new LexemeResolver(tx), {
      sectionId,
      segmented,
      dictionary: analyzer.dictionary,
      // A transcript's review flag is per sentence and the boundaries moved, so
      // it is kept only as "some of this still needs reading".
      needsReview: old.some((s) => s.needsReview),
    });
    linkLexemes(tx);

    let progressSentenceId: string | null = null;
    if (bookmark) {
      let best = 0;
      segmented.forEach((sentence, index) => {
        const overlap =
          Math.min(sentence.charEnd, bookmark.end) -
          Math.max(sentence.charStart, bookmark.start);
        if (overlap > best) {
          best = overlap;
          progressSentenceId = ids[index]!;
        }
      });
    }

    // Same connection, so this reads the rows just written.
    const added = [...ambiguousIn(sectionId)].filter((id) => !before.has(id));

    tx.update(sections)
      .set({
        progressSentenceId,
        analyzerId: analyzer.id,
        analyzerVersion: analyzer.version,
        tokenizedAt: Math.floor(Date.now() / 1000),
        ...(added.length > 0
          ? { resolvedAt: null, resolveTotal: section.resolveTotal + added.length }
          : {}),
      })
      .where(eq(sections.id, sectionId))
      .run();
  });
}

/**
 * Where the bookmarked sentence's text sits in the source. Old sentences are
 * found in order, each after the last, so a sentence repeated in the chapter
 * resolves to the right occurrence.
 */
function locate(
  body: string,
  old: { id: string; text: string }[],
  sentenceId: string | null,
): { start: number; end: number } | null {
  if (sentenceId === null) return null;
  let cursor = 0;
  for (const sentence of old) {
    const at = body.indexOf(sentence.text, cursor);
    if (at === -1) continue;
    if (sentence.id === sentenceId) return { start: at, end: at + sentence.text.length };
    cursor = at + sentence.text.length;
  }
  return null;
}
