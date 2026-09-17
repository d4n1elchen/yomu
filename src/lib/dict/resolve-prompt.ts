import type { LlmMessage } from '../llm/index.ts';

/** One JMdict entry the word might be, offered to the model to choose between. */
export interface ResolverCandidate {
  /** JMdict's `ent_seq` -- the id the model must return verbatim to pick it. */
  entryId: string;
  headword: string;
  reading: string;
  /**
   * The entry's senses that fit the word's grammar, first few only -- or its
   * leading sense when none does.
   *
   * One leading gloss was not enough to choose on. JMdict orders an entry's
   * senses by commonness across every use, so the sense a grammatical word takes
   * is often not the first: 目 leads with "eye" and carries the ordinal "-th" as
   * a suffix sense further down, and shown only "eye" the model preferred 奴
   * "bastard" for the め of 二つ目.
   */
  glosses: string[];
  /** JMdict ranks or flags the entry as common. */
  common: boolean;
}

export interface ResolverContext {
  /**
   * Sentences the word occurs in, with the surface as written in each. Several,
   * because the link is per word rather than per occurrence: the pick has to fit
   * how the word is used, not one sentence that may be the odd one out.
   */
  occurrences: Array<{ sentence: string; surface: string }>;
  /** The surviving entries, best-deterministic-guess first. */
  candidates: ResolverCandidate[];
}

/** The reply that rejects every candidate. */
export const NONE = 'none';

/**
 * It selects, it does not name. Given a real list of JMdict entries that all
 * share this word's lemma, reading and grammar, the model picks which one the
 * sentence means -- 成る "to become" over 生る "to bear fruit". That is a choice
 * a model can make in context and cannot invent its way out of, the same
 * grounding the glosses rely on. It is never asked for a reading.
 *
 * It may also reject the whole list. Without that, a list that does not hold the
 * right entry still got a confident pick: 〜てく's く has no entry, and the model
 * chose 句 "passage of text" because it had to choose something. A rejection
 * unlinks the word, which marks it for the reader rather than misinforming them.
 *
 * Rejection is fenced in, because the first run over-used it: told only to reject
 * when nothing fits, the model rejected 言う, 持つ, 上げる, 通り, 筈 and 知れる --
 * every one a word being used as a helper, where it reasoned that the dictionary
 * entry was not what the sentence meant. That is arguable and it is not what the
 * reader needs: an unlinked word loses its glosses and is marked hard. So the
 * prompt says outright that a helper use still takes its own entry.
 */
const SYSTEM = `你是一位日語辭典編輯。一個詞在文章裡出現，對應到好幾個同形同音、詞性也相同的辭書詞條，你要判斷它是哪一條。

規則：
- 你是在**從清單裡挑選**，不是命名或創造。只能回傳清單中出現過的其中一個 id，或 "${NONE}"。
- 依例句的意思判斷，選最貼切的那一條。每個詞條列出了與這個詞詞性相符的語義。
- 標為「常用」的詞條遠比「少用」的常見。沒有明確理由時，選常用的那一條。
- 只有當清單中**沒有任何一條**是這個詞時，才回傳 "${NONE}"，例如這是清單裡完全沒收錄的文法成分。
- 補助用法仍要選詞條：像「〜ていく」的 いく、「〜ておく」的 おく、形式名詞的 こと、はず、とおり，都選它本來的那一條，不要因為句中是文法用法就回傳 "${NONE}"。
- 以 JSON 物件回覆，格式為 {"entryId": "清單中的其中一個 id 或 ${NONE}"}。`;

/** The reply schema: exactly one entry id, or `none`, validated against the
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
  if (context.occurrences.length === 0) {
    throw new Error('At least one occurrence is required to resolve.');
  }

  const list = context.candidates
    .map(
      (candidate) =>
        `- ${candidate.entryId}：${candidate.headword}（${candidate.reading}）` +
        `〔${candidate.common ? '常用' : '少用'}〕 ${candidate.glosses.join(' / ')}`,
    )
    .join('\n');

  const examples = context.occurrences
    .map((occurrence, index) => `${index + 1}. ${occurrence.sentence}（「${occurrence.surface}」）`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `例句（括號裡是這個詞在句中的寫法）：\n${examples}\n\n` +
        `這個詞對應下列哪一個詞條？\n${list}`,
    },
  ];
}

/**
 * Reads the reply: the chosen id when it is one of the ids offered, `NONE` when
 * the model rejected every one, and null for anything else -- a hallucinated
 * id, malformed JSON, an entry the model wished existed -- which the caller
 * treats as no opinion and keeps the deterministic pick. Same shape as
 * validating the translation's sense count.
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
  if (entryId === NONE) return NONE;

  return new Set(candidateIds).has(entryId) ? entryId : null;
}
