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
  /** The part of this sentence the reader selected. */
  selected: string;
}

export interface PromptInput {
  /** Every sentence the selection touched, in reading order. */
  sentences: PromptSentence[];
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
- 學生選取的是句子的一部分，就針對該部分回答；整句只當作理解的脈絡，不要重講整句。
- 不確定的地方就說不確定，不要編造。`;

function describe(sentence: PromptSentence, index: number, total: number): string {
  const table = sentence.tokens
    .map((token) => {
      const reading = token.reading ? toHiragana(token.reading) : '—';
      const lemma = token.lemma !== token.surface ? ` ← ${token.lemma}` : '';
      return `- ${token.surface}（${reading}）${token.pos}${lemma}`;
    })
    .join('\n');

  const heading = total === 1 ? '句子' : `句子 ${index + 1}`;
  return `${heading}：\n${sentence.text}\n\n詞法分析結果（讀音為準，請勿更動）：\n${table}`;
}

/**
 * The reading context is attached to the first question rather than sent as its
 * own turn, so a long conversation never repeats the token tables -- the model
 * keeps seeing them at the top of the thread where they were established.
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
  if (input.sentences.length === 0) {
    throw new Error('A selection is required.');
  }

  const [first, ...rest] = input.turns;
  const context = input.sentences
    .map((sentence, index) =>
      describe(sentence, index, input.sentences.length),
    )
    .join('\n\n');

  const selected = input.sentences
    .map((sentence) => sentence.selected)
    .join('');

  return [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `${context}\n\n` +
        `學生選取的片段：「${selected}」\n\n` +
        `問題：${first!.content}`,
    },
    ...rest,
  ];
}
