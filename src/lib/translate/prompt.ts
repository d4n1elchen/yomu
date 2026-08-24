import type { LlmMessage } from '../llm/index.ts';

/** One JMdict sense handed to the model to translate. */
export interface TranslationSense {
  /** JMdict's own POS tags for the sense (n, v5r, adj-i...), shown as context
   *  for register, never as something to reinterpret. */
  pos: string;
  /** JMdict's English gloss -- the thing being translated, not redefined. */
  glossEn: string;
}

/** One dictionary entry: all of its senses, translated together so their order
 *  and structure survive. */
export interface TranslationEntry {
  /** The Japanese headword, as grounding. Studied material handed over as fact,
   *  not a word the model is asked to read or re-gloss. */
  headword: string;
  reading: string;
  senses: TranslationSense[];
}

/**
 * It translates JMdict's English glosses into Traditional Chinese; it does not
 * define the word afresh. This is the grounding rule the Q&A prompt follows for
 * the same reason -- given a real sense to render the model can mistranslate,
 * but it cannot invent a meaning the dictionary never had. And it is never asked
 * for a reading: `reading` is supplied, never solicited.
 */
const SYSTEM = `你是一位日中辭典編輯，把日語詞條既有的英文語義翻成繁體中文（台灣用語）。

規則：
- 一律使用**繁體中文（台灣用語）**。絕對不要使用簡體字，也不要用英文或日文作答。
- 你是在**翻譯**既有的語義，不是重新定義這個詞。忠實翻出每一條英文語義，不要增減或自行詮釋。
- 逐條對應：送進幾條語義就回幾條，順序與送進來的一致。
- 每條譯文精簡，像辭典釋義，不要整句翻譯後再解釋，也不要加註。
- 以 JSON 物件回覆，格式為 {"senses": ["第一條的譯文", "第二條的譯文", …]}。`;

/**
 * The reply schema. `senses` is a flat array of Chinese strings, one per English
 * gloss sent, in the same order -- so alignment is by position and the only
 * thing to validate is that the counts match.
 */
export const TRANSLATION_FORMAT = {
  type: 'object',
  properties: {
    senses: { type: 'array', items: { type: 'string' } },
  },
  required: ['senses'],
} as const;

export function buildTranslationMessages(entry: TranslationEntry): LlmMessage[] {
  if (entry.senses.length === 0) {
    throw new Error('An entry with at least one sense is required.');
  }

  const list = entry.senses
    .map((sense, index) => `${index + 1}. （${sense.pos}）${sense.glossEn}`)
    .join('\n');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `詞條：${entry.headword}（${entry.reading}）\n\n` +
        `英文語義（共 ${entry.senses.length} 條，請逐條翻成繁體中文）：\n${list}`,
    },
  ];
}

/**
 * Parses the model's reply and accepts it only when it is well-formed JSON with
 * exactly `expected` non-empty strings. A count mismatch means the model dropped
 * or merged a sense and the alignment is gone, so the whole reply is rejected
 * rather than written half-right -- the caller retries once, then leaves null.
 */
export function parseTranslation(raw: string, expected: number): string[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const senses = (data as { senses?: unknown }).senses;
  if (!Array.isArray(senses) || senses.length !== expected) return null;

  const out: string[] = [];
  for (const sense of senses) {
    if (typeof sense !== 'string' || sense.trim() === '') return null;
    out.push(sense.trim());
  }
  return out;
}
