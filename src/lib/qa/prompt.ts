import type { LlmMessage } from '../llm/index.ts';
import { toHiragana } from '../text/kana.ts';

export interface PromptToken {
  surface: string;
  reading: string | null;
  lemma: string;
  pos: string;
}

export interface PromptSentence {
  text: string;
  tokens: PromptToken[];
}

export interface PromptInput {
  /** The sentence the reader double-tapped: the one being asked about. */
  target: PromptSentence;
  /** The sentences either side, as plain text. Null at a chapter's edge. */
  previous: string | null;
  next: string | null;
  /** The alternating user/assistant turns so far, oldest first. */
  turns: LlmMessage[];
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
- 學生問的是【目標句】。【前一句】與【後一句】只是幫助理解的脈絡（省略的主詞、指示詞指的是什麼、語氣從何而來），除非學生問起，不要解釋它們。
- 不確定的地方就說不確定，不要編造。`;

function table(tokens: PromptToken[]): string {
  return tokens
    .map((token) => {
      const reading = token.reading ? toHiragana(token.reading) : '—';
      const lemma = token.lemma !== token.surface ? ` ← ${token.lemma}` : '';
      return `- ${token.surface}（${reading}）${token.pos}${lemma}`;
    })
    .join('\n');
}

/**
 * The target is labelled, and the labels are repeated in the rules and at the
 * question, because three adjacent sentences of similar length otherwise read
 * as one passage -- and a model asked to explain a passage explains all of it.
 *
 * Only the target carries a token table. The neighbours are there to resolve
 * what the target leaves out, not to be explained, and a table for each would
 * triple the prompt and invite the model to walk through them.
 *
 * A missing neighbour is left out rather than marked empty: at a chapter's first
 * sentence there is simply nothing before it.
 *
 * The reading context is attached to the first question rather than sent as its
 * own turn, so a long conversation never repeats the token table -- the model
 * keeps seeing it at the top of the thread where it was established.
 *
 * The card's opening greeting is templated on the client and is deliberately
 * not among the turns: it is the interface speaking, not something the model
 * said, and feeding it back would invite the model to treat its own canned
 * line as context.
 */
export function buildMessages(input: PromptInput): LlmMessage[] {
  if (input.turns.length === 0) {
    throw new Error('A question is required.');
  }

  const [first, ...rest] = input.turns;
  const blocks = [
    input.previous !== null ? `【前一句】（僅供脈絡）\n${input.previous}` : null,
    `【目標句】（學生問的是這一句）\n${input.target.text}`,
    input.next !== null ? `【後一句】（僅供脈絡）\n${input.next}` : null,
    `【目標句】的詞法分析結果（讀音為準，請勿更動）：\n${table(input.target.tokens)}`,
    `關於【目標句】的問題：${first!.content}`,
  ];

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content: blocks.filter((block) => block !== null).join('\n\n'),
    },
    ...rest,
  ];
}
