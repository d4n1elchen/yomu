import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sections, sentences, tokens, works } from '../../db/schema.ts';
import { getAnalyzer } from '../analyzer/index.ts';
import { linkLexemes } from '../dict/match.ts';
import { segmentSentences, type SegmentedSentence } from '../text/sentences.ts';
import { LexemeResolver, writeSentenceTokens } from './tokens.ts';

/** Sparse ordering leaves room to insert without renumbering siblings. */
const ORDER_STEP = 1000;

export interface IngestSection {
  title?: string | null;
  body: string;
  /** 'text' | 'transcript' -- transcripts are inherently suspect. */
  origin?: string;
}

export interface IngestWork {
  title: string;
  author?: string | null;
  /** 'paste' | 'file' | 'url' | 'transcript' */
  sourceType: string;
  sourceUrl?: string | null;
  sections: IngestSection[];
}

export interface IngestResult {
  workId: string;
  sectionIds: string[];
}

/**
 * Takes a list of sections even though pasting only ever supplies one. Whole
 * novels are the target shape and an article is just the one-section case, so
 * multi-section import should be a change at the call site rather than here.
 */
export async function ingestWork(input: IngestWork): Promise<IngestResult> {
  const analyzer = getAnalyzer();

  // All analysis happens up front: better-sqlite3 transactions are synchronous
  // and cannot await, so nothing async may run once one is open.
  const prepared = await Promise.all(
    input.sections.map(async (section) => {
      const body = section.body.replace(/\r\n?/gu, '\n');
      const analyzed = await analyzer.analyze(body);
      return {
        section,
        body,
        segmented: segmentSentences(body, analyzed),
      };
    }),
  );

  const result = db.transaction((tx) => {
    const workId = randomUUID();
    tx.insert(works)
      .values({
        id: workId,
        title: input.title,
        author: input.author ?? null,
        sourceType: input.sourceType,
        sourceUrl: input.sourceUrl ?? null,
      })
      .run();

    const resolver = new LexemeResolver(tx);
    const sectionIds: string[] = [];
    const now = Math.floor(Date.now() / 1000);

    prepared.forEach(({ section, body, segmented }, index) => {
      const sectionId = randomUUID();
      sectionIds.push(sectionId);

      const origin = section.origin ?? 'text';
      tx.insert(sections)
        .values({
          id: sectionId,
          workId,
          parentId: null,
          orderIndex: (index + 1) * ORDER_STEP,
          title: section.title ?? null,
          sourceText: body,
          origin,
          // Transcripts arrive unread; typed and pasted text does not.
          editState: origin === 'transcript' ? 'needs_review' : 'editable',
          analyzerId: analyzer.id,
          analyzerVersion: analyzer.version,
          tokenizedAt: now,
        })
        .run();

      writeSentences(tx, resolver, {
        sectionId,
        segmented,
        dictionary: analyzer.dictionary,
        needsReview: origin === 'transcript',
      });
    });

    // New text means new lexemes, and a lexeme with no dictionary entry has no
    // frequency band -- so the reader would mark every word in a freshly
    // imported article as hard. Only the unlinked rows are touched, and it is a
    // no-op when JMdict has not been imported yet.
    linkLexemes(tx);

    // The denominator for the Library's progress readout, counted now so a
    // freshly imported article shows "0 / n" rather than an empty bar while the
    // drain is still spinning up. The drain recomputes it when it starts.
    for (const sectionId of sectionIds) {
      const ambiguous = tx
        .select({ n: sql<number>`count(distinct ${lexemes.id})` })
        .from(lexemes)
        .innerJoin(tokens, eq(tokens.lexemeId, lexemes.id))
        .innerJoin(sentences, eq(sentences.id, tokens.sentenceId))
        .where(
          sql`${sentences.sectionId} = ${sectionId}
            and ${lexemes.dictMatch} = 'lemma_reading_multi'
            and ${lexemes.dictResolver} is null`,
        )
        .get();

      // Nothing ambiguous means nothing to wait for: stamp it readable now
      // rather than making the drain do a lap to discover an empty list.
      const total = ambiguous?.n ?? 0;
      tx.update(sections)
        .set({
          resolveTotal: total,
          resolveDone: 0,
          resolvedAt: total === 0 ? now : null,
        })
        .where(eq(sections.id, sectionId))
        .run();
    }

    return { workId, sectionIds };
  });

  // No model work here, deliberately. Both passes are background work owned by
  // `ensureDraining`, which the caller kicks off after the response: a chapter
  // needs hundreds of requests against a host Ollama serializes anyway, and
  // holding the import open for that is what made a paste feel like a hang.
  //
  // What the transaction leaves behind is a complete, correct article --
  // sentences, tokens, lexemes and their JMdict links. All that is missing is
  // the model's opinion: which entry an ambiguous word is, and the Chinese for
  // the senses. The first gates reading (it moves `dictEntryId`), the second
  // gates nothing.
  return result;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function writeSentences(
  tx: Tx,
  resolver: LexemeResolver,
  options: {
    sectionId: string;
    segmented: SegmentedSentence[];
    dictionary: string;
    needsReview: boolean;
  },
): void {
  const { sectionId, segmented, dictionary, needsReview } = options;

  segmented.forEach((sentence, index) => {
    const sentenceId = randomUUID();
    tx.insert(sentences)
      .values({
        id: sentenceId,
        sectionId,
        orderIndex: (index + 1) * ORDER_STEP,
        text: sentence.text,
        needsReview,
        paragraphStart: sentence.paragraphStart,
      })
      .run();

    writeSentenceTokens(tx, resolver, {
      sentenceId,
      sentenceStart: sentence.charStart,
      dictionary,
      analyzed: sentence.tokens,
    });
  });
}
