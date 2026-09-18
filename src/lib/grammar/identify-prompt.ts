/**
 * Asks the model which of the matched spans are really grammar, and which
 * meaning each one carries.
 *
 * It selects, it does not name -- the same division as the homograph resolver
 * in `src/lib/dict/resolve-prompt.ts`, and for the same reason: a model that
 * names grammar points invents near-duplicates, and a key that drifts cannot be
 * a key. Every id it may answer with came from the matcher, and anything else
 * is dropped when the reply is read.
 *
 * **One request for the whole sentence, not one per span.** Measured on 200
 * labelled spans: per span, 86% precision and 79% recall; per sentence, 85% and
 * 91%, at 8.5s median for a sentence rather than 2.3s per span. The gain is
 * recall, and the reason is context -- a model that has already accounted for
 * ている in the sentence stops rejecting てくる standing next to it.
 *
 * The spans are shown with the point's **Chinese name and gloss**, not つつじ's
 * own labels. Shown 過去-完了-タ類 for てしまう, the model rejected obvious uses;
 * recall rose from 68% to 79% when it was shown ～てしまう（完了/遺憾）instead.
 */

import type { LlmMessage } from '../llm/index.ts';

/** One point the reader could be offered, as the prompt presents it. */
export interface PromptCandidate {
  /** The grammar point's id -- what the model must answer with, verbatim. */
  pointId: string;
  /** Traditional Chinese name, e.g. ～ている（正在…／狀態）. */
  name: string;
  gloss: string;
}

/** One matched span, numbered so the reply can refer to it. */
export interface PromptSpan {
  n: number;
  /** The matched text as written -- often a fragment: てい of ～ていた. */
  surface: string;
  /** A few characters either side, so the span is read in context. */
  before: string;
  after: string;
  candidates: PromptCandidate[];
}

export interface IdentifyInput {
  sentence: string;
  spans: PromptSpan[];
}

const SYSTEM = `你是一位日語文法老師，學生的母語是繁體中文。學生正在讀一句日文，想把句中的文法句型收進自己的文法庫。

詞法分析器已經在句中標出幾個「可能是文法句型」的片段，每個片段附上候選句型。你要逐一判斷。

規則：
- 對每個片段，回傳它在此句中對應的候選 id。你是在**從清單裡挑選**，不是命名或創造，id 只能是該片段自己的候選之一。
- 片段常常只是句型的活用形、口語縮約，或只露出句型的一部分（例如句型「～ておく」在句中寫成「とい」或「ておけ」），這些都算是該句型的用法。
- 同一個句型列出多個意義時，選符合此句語意的那一個。
- 只有在片段**其實不是**那個句型時（例如「について」其實是動詞「付く」的て形、「ところ」只是表示地點的名詞），或此句的意義與每個候選都不符時，才回傳 "none"。
- 另外，如果句中還有值得學習、但不在片段清單裡的文法句型，列在 others：form 是句中原文，name 是簡短的句型名稱。沒有就給空陣列。不要列單字，也不要列一般助詞。
- 以 JSON 回覆：{"spans":[{"n":片段編號,"id":"候選 id 或 none"}],"others":[{"form":"…","name":"…"}]}`;

/** The reply schema. Ids are validated against the offered set regardless. */
export const IDENTIFY_FORMAT = {
  type: 'object',
  properties: {
    spans: {
      type: 'array',
      items: {
        type: 'object',
        properties: { n: { type: 'integer' }, id: { type: 'string' } },
        required: ['n', 'id'],
      },
    },
    others: {
      type: 'array',
      items: {
        type: 'object',
        properties: { form: { type: 'string' }, name: { type: 'string' } },
        required: ['form', 'name'],
      },
    },
  },
  required: ['spans', 'others'],
} as const;

/**
 * Changes whenever the question put to the model does: the rules, or the shape
 * of the reply. Part of the cache version, so editing the prompt re-analyses
 * rather than serving answers to the old one.
 */
export const IDENTIFY_PROMPT_TEXT = `${SYSTEM}\n${JSON.stringify(IDENTIFY_FORMAT)}`;

export function buildIdentifyMessages(input: IdentifyInput): LlmMessage[] {
  if (input.spans.length === 0) {
    throw new Error('At least one span is required to identify.');
  }

  const blocks = input.spans.map((span) => {
    const candidates = span.candidates
      .map((candidate) => `  - ${candidate.pointId}：${candidate.name}——${candidate.gloss}`)
      .join('\n');
    return `片段 ${span.n}：${span.before}【${span.surface}】${span.after}\n${candidates}`;
  });

  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `句子：${input.sentence}\n\n${blocks.join('\n\n')}` },
  ];
}

export interface Identification {
  /** Span number to the point it is, for spans the model accepted. */
  picks: Map<number, string>;
  /** Grammar the model saw that the inventory has no entry for. */
  others: { form: string; name: string }[];
}

/**
 * Reads the reply, keeping only what was actually offered.
 *
 * A span number that was never asked about, an id that belongs to a different
 * span, an id no one offered -- all dropped. Same contract as
 * `parseResolution`: the model's answer is a choice among things the code
 * already knows, so anything else is a misunderstanding rather than news.
 */
export function parseIdentification(
  raw: string,
  spans: PromptSpan[],
): Identification | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;

  const allowed = new Map(
    spans.map((span) => [span.n, new Set(span.candidates.map((c) => c.pointId))]),
  );

  const picks = new Map<number, string>();
  const { spans: replied, others } = data as Record<string, unknown>;
  if (Array.isArray(replied)) {
    for (const item of replied) {
      if (typeof item !== 'object' || item === null) continue;
      const { n, id } = item as Record<string, unknown>;
      if (typeof n !== 'number' || typeof id !== 'string') continue;
      if (allowed.get(n)?.has(id)) picks.set(n, id);
    }
  }

  const proposals: { form: string; name: string }[] = [];
  if (Array.isArray(others)) {
    for (const item of others) {
      if (typeof item !== 'object' || item === null) continue;
      const { form, name } = item as Record<string, unknown>;
      if (typeof form !== 'string' || typeof name !== 'string') continue;
      if (!form.trim() || !name.trim()) continue;
      // Only what is really in the sentence: a proposal the reader cannot find
      // is not something to explain, and nothing here can be added anyway.
      proposals.push({ form: form.trim(), name: name.trim() });
    }
  }

  return { picks, others: proposals };
}
