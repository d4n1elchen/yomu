import type { LlmMessage } from '../llm/index.ts';

/** One JMdict entry the word might be, offered to the model to choose between. */
export interface ResolverCandidate {
  /** JMdict's `ent_seq` -- the id the model must return verbatim to pick it. */
  entryId: string;
  headword: string;
  reading: string;
  /** JMdict's leading English gloss, enough to tell the entries apart. */
  glossEn: string;
}

export interface ResolverContext {
  /** A sentence the word occurs in, as the disambiguating context. */
  sentence: string;
  /** The surface form as written in that sentence. */
  surface: string;
  /** The surviving entries, best-deterministic-guess first. */
  candidates: ResolverCandidate[];
}

/**
 * It selects, it does not name. Given a real list of JMdict entries that all
 * share this word's lemma, reading and grammar, the model picks which one the
 * sentence means -- 成る "to become" over 生る "to bear fruit". That is a choice
 * a model can make in context and cannot invent its way out of, the same
 * grounding the glosses rely on. It is never asked for a reading.
 */
const SYSTEM = `你是一位日語辭典編輯。句子裡有一個詞，對應到好幾個同形同音、詞性也相同的辭書詞條，你要判斷在這個句子裡它是哪一條。

規則：
- 你是在**從清單裡挑選**，不是命名或創造。只能回傳清單中出現過的其中一個 id。
- 依句子的意思判斷，選最貼切的那一條。
- 不確定時，選語感上最自然、最常見的一條。
- 以 JSON 物件回覆，格式為 {"entryId": "清單中的其中一個 id"}。`;

/** The reply schema: exactly one entry id, which must be validated against the
 *  candidate set before it is trusted. */
export const RESOLVER_FORMAT = {
  type: 'object',
  properties: {
    entryId: { type: 'string' },
  },
  required: ['entryId'],
} as const;

export function buildResolverMessages(context: ResolverContext): LlmMessage[] {
  if (context.candidates.length < 2) {
    throw new Error('At least two candidates are required to resolve.');
  }

  const list = context.candidates
    .map(
      (candidate) =>
        `- ${candidate.entryId}：${candidate.headword}（${candidate.reading}） ${candidate.glossEn}`,
    )
    .join('\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `句子：${context.sentence}\n\n` +
        `句中的「${context.surface}」對應下列哪一個詞條？\n${list}`,
    },
  ];
}

/**
 * Reads the reply and returns the chosen id only when it is one of the ids that
 * were offered. Anything else -- a hallucinated id, malformed JSON, an entry the
 * model wished existed -- is rejected, and the caller keeps the deterministic
 * pick. Same shape as validating the translation's sense count.
 */
export function parseResolution(
  raw: string,
  candidateIds: Iterable<string>,
): string | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const entryId = (data as { entryId?: unknown }).entryId;
  if (typeof entryId !== 'string') return null;

  return new Set(candidateIds).has(entryId) ? entryId : null;
}
