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
import { getLlmProvider } from '../llm/index.ts';
import { analysisVersion, readAnalysis, writeAnalysis } from './cache.ts';
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
  /** Served from `grammar_analysis` rather than asked of the model just now. */
  cached: boolean;
}

const NONE = { points: [], others: [], answered: false, cached: false };

export interface GrammarInSentenceOptions {
  signal?: AbortSignal;
  /** Ask the model again even when a cached analysis is still valid: 重新分析. */
  fresh?: boolean;
}

export async function grammarInSentence(
  sentenceId: string,
  options: GrammarInSentenceOptions = {},
): Promise<SentenceGrammar> {
  const { signal, fresh = false } = options;
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

  const provider = getLlmProvider();
  // Any model on the list will do for a cached answer, best first: an answer
  // the fallback gave while the cloud was down is still this sentence's answer,
  // and the cards stay put. 重新分析 asks the first model again.
  if (!fresh) {
    for (const model of provider.models ?? [provider.model]) {
      const version = analysisVersion(model, grammar);
      const hit = readAnalysis(sentenceId, sentence.revision, version, grammar);
      if (hit) {
        return { ...hit, sentence: sentence.text, revision: sentence.revision, cached: true };
      }
    }
  }

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
    provider,
    signal,
  });
  // Only a readable answer is remembered. An unreadable one looks like "no
  // grammar here", and caching it would keep saying so after the model recovers.
  // Filed under the model that actually answered, which after a fallback is
  // not the first one on the list.
  if (identified.answered) {
    const version = analysisVersion(provider.model, grammar);
    writeAnalysis(sentenceId, sentence.revision, version, identified);
  }

  return {
    ...identified,
    sentence: sentence.text,
    revision: sentence.revision,
    cached: false,
  };
}
