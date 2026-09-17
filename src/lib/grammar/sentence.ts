/**
 * The grammar cards for one stored sentence.
 *
 * The reader asks about a sentence; this matches the inventory over the tokens
 * that sentence already has, asks the model which matches are real, and returns
 * what the card should offer. Nothing is written: a card is a card until the
 * reader adds it, and Q&A itself still stores nothing.
 *
 * Tokens are read rather than re-analysed. They are the same tokens the reader
 * is looking at, so a card's offsets line up with the text on screen, and a
 * sentence edited since tokenizing cannot drift between the two.
 */

import { asc, eq } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { lexemes, sentences, tokens } from '../../db/schema.ts';
import { identifyGrammar, type Identified } from './identify.ts';
import { loadGrammar } from './load.ts';
import { matchSentence, type MatchToken } from './match.ts';

export interface SentenceGrammar extends Identified {
  /** The sentence's own text, so the card can mark the span in it. */
  sentence: string;
  /**
   * The revision the spans were found against. A card added later carries it,
   * so an edited sentence makes the occurrence detectably stale rather than
   * silently pointing at the wrong characters -- the same anchor Q&A uses.
   */
  revision: number;
}

const NONE = { points: [], others: [] };

export async function grammarInSentence(
  sentenceId: string,
  signal?: AbortSignal,
): Promise<SentenceGrammar> {
  const sentence = db
    .select({ text: sentences.text, revision: sentences.revision })
    .from(sentences)
    .where(eq(sentences.id, sentenceId))
    .get();
  if (!sentence) throw new Error('Sentence not found.');

  const empty: SentenceGrammar = {
    ...NONE,
    sentence: sentence.text,
    revision: sentence.revision,
  };

  const grammar = loadGrammar();
  // No inventory is the state of a fresh clone, where `npm run db:tsutsuji`
  // has not been run. The panel shows no grammar, the same way the reader hides
  // its difficulty slider when JMdict is missing rather than marking every word.
  if (grammar.size === 0) return empty;

  const rows = db
    .select({
      surface: tokens.surface,
      features: tokens.features,
      charStart: tokens.charStart,
      charEnd: tokens.charEnd,
      lemma: lexemes.lemma,
      pos: lexemes.pos,
    })
    .from(tokens)
    .innerJoin(lexemes, eq(lexemes.id, tokens.lexemeId))
    .where(eq(tokens.sentenceId, sentenceId))
    .orderBy(asc(tokens.orderIndex))
    .all();

  const matchable: MatchToken[] = rows.map((row) => ({
    surface: row.surface,
    lemma: row.lemma,
    pos: row.pos,
    charStart: row.charStart,
    charEnd: row.charEnd,
    features: JSON.parse(row.features) as MatchToken['features'],
  }));

  const matches = matchSentence(matchable, grammar.inventory);
  if (matches.length === 0) return empty;

  const identified = await identifyGrammar({
    sentence: sentence.text,
    matches,
    grammar,
    signal,
  });

  return { ...identified, sentence: sentence.text, revision: sentence.revision };
}
