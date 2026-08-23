import type { LlmMessage } from '../llm/index.ts';
import { toHiragana } from '../text/kana.ts';

export interface PromptToken {
  surface: string;
  reading: string | null;
  lemma: string;
  pos: string;
}

export interface PromptInput {
  sentenceText: string;
  tokens: PromptToken[];
  /** The sub-span the reader highlighted, if any. */
  selection?: string | null;
  question: string;
}

/**
 * Every model tested invents readings when asked to explain a sentence --
 * qwen3.8 rendered 窓の外 as まどのはら. So the analyzer's segmentation and
 * readings are handed to the model as fact, and the model is told not to
 * produce its own. The division of labour is the whole point: the analyzer
 * owns readings and dictionary forms, the LLM owns grammar and nuance.
 */
const SYSTEM = `你是一位日語文法老師，學生的母語是繁體中文。

規則：
- 一律使用**繁體中文（台灣用語）**。絕對不要使用簡體字。
- 讀音與辭書形已由詞法分析器提供，是正確的。請直接採用，**不要自行推測或改寫任何讀音**。
- 聚焦在文法：句型、活用、助詞的作用、語氣與語感差異。
- 說明要精簡，用條列式。不要重複整句翻譯之後才開始解釋。
- 如果學生問的是特定片段，就針對該片段回答，不要重講整句。
- 不確定的地方就說不確定，不要編造。`;

export function buildMessages(input: PromptInput): LlmMessage[] {
  const table = input.tokens
    .map((token) => {
      const reading = token.reading ? toHiragana(token.reading) : '—';
      const lemma = token.lemma !== token.surface ? ` ← ${token.lemma}` : '';
      return `- ${token.surface}（${reading}）${token.pos}${lemma}`;
    })
    .join('\n');

  const selection = input.selection
    ? `\n學生選取的片段：「${input.selection}」\n`
    : '\n';

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `句子：\n${input.sentenceText}\n\n` +
        `詞法分析結果（讀音為準，請勿更動）：\n${table}\n` +
        selection +
        `\n問題：${input.question}`,
    },
  ];
}
