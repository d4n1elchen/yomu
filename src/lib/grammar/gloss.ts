/**
 * Writes the Traditional Chinese name and gloss on every grammar point.
 *
 * つつじ describes a point in Japanese linguistics vocabulary -- ～てしまう is
 * 過去-完了-タ類 -- which is not something to put in front of a reader, and
 * measurably not something to put in front of the model either: shown those
 * labels it rejected obvious uses, and recall rose from 68% to 79% when it was
 * shown ～てしまう（完了/遺憾）instead.
 *
 * So each point gets a name and a one-line gloss, written once and then
 * **reviewed by hand** before any of it reaches a card. Display text only: the
 * key is つつじ's id, so a clumsy gloss costs clarity and can never create a
 * duplicate. That is the same division `dictSense.glossZh` follows.
 *
 * Points are glossed in batches of meaning-class siblings, because the hard
 * part is telling them apart: ために "because" and ために "in order to" are one
 * base and two points, and a gloss written without the other in view describes
 * neither.
 */

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client.ts';
import { grammarForms, grammarPoints } from '../../db/schema.ts';
import { collect, getLlmProvider, type LlmProvider } from '../llm/index.ts';

/** Points per request. Enough for a class to be seen together, few enough to fit. */
const BATCH = 8;

/** Written forms shown per point: sound changes and spellings, not all 40. */
const FORMS = 6;

const SYSTEM = `你是一位日語文法辭典編輯，讀者是母語為繁體中文（台灣）的日語學習者。
你會拿到一批日語「機能表現」（文法句型）詞條。每個詞條有：id、代表形式、日語語言學的意義分類標籤、以及它的幾個異形（活用、口語、敬體、表記）。
同一個代表形式可能有好幾個詞條，差別只在意義分類——請務必讓它們的說明彼此區分得開。

為每個詞條寫：
- name：學習者看得懂的句型名稱，以「～」開頭的日文句型加上簡短中文，例如「～ながら（雖然…卻）」。
- gloss：一句繁體中文，說明這個意義在句中的作用，20 字以內。

只用繁體中文與日文，不要用簡體字，也不要用英文。以 JSON 回覆：
{"items":[{"id":"…","name":"…","gloss":"…"}]}`;

const FORMAT = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          gloss: { type: 'string' },
        },
        required: ['id', 'name', 'gloss'],
      },
    },
  },
  required: ['items'],
} as const;

interface Pending {
  id: string;
  base: string;
  meaningName: string;
}

export function pendingGlossCount(): number {
  return db
    .select({ id: grammarPoints.id })
    .from(grammarPoints)
    .where(or(isNull(grammarPoints.nameZh), isNull(grammarPoints.glossZh)))
    .all().length;
}

/**
 * Ordered by meaning class, so a batch holds points that a reader would have to
 * tell apart, and the model writes their glosses in view of each other.
 */
function pending(limit: number): Pending[] {
  return db
    .select({
      id: grammarPoints.id,
      base: grammarPoints.base,
      meaningName: grammarPoints.meaningName,
    })
    .from(grammarPoints)
    .where(or(isNull(grammarPoints.nameZh), isNull(grammarPoints.glossZh)))
    .orderBy(asc(grammarPoints.meaningClass), asc(grammarPoints.id))
    .limit(limit)
    .all();
}

/** A few of the point's written forms: what the gloss has to cover. */
function formsOf(pointId: string): string[] {
  return db
    .select({ units: grammarForms.units })
    .from(grammarForms)
    .where(eq(grammarForms.pointId, pointId))
    .limit(FORMS)
    .all()
    .map((form) => form.units.replaceAll('.', ''));
}

/** Rejects a reply that drifted into Simplified Chinese or English prose. */
function usable(text: string): boolean {
  if (text.length === 0 || text.length > 60) return false;
  // A gloss is Chinese and Japanese; a stray Latin word means the model
  // answered in the wrong language, which is a re-ask rather than a save.
  return !/[A-Za-z]{4,}/u.test(text);
}

export interface GlossProgress {
  glossed: number;
  failed: number;
}

/**
 * Fills in what is missing. Returns when the queue is empty or the model stops
 * producing usable replies -- a batch that fails is left for a later run rather
 * than retried forever, exactly like the translation drain.
 */
export async function glossGrammarPoints(options?: {
  provider?: LlmProvider;
  limit?: number;
  onBatch?: (progress: GlossProgress) => void;
}): Promise<GlossProgress> {
  const provider = options?.provider ?? getLlmProvider();
  const budget = options?.limit ?? Number.POSITIVE_INFINITY;

  const progress: GlossProgress = { glossed: 0, failed: 0 };

  while (progress.glossed + progress.failed < budget) {
    const batch = pending(Math.min(BATCH, budget - progress.glossed - progress.failed));
    if (batch.length === 0) break;

    const lines = batch
      .map(
        (point) =>
          `- id ${point.id}｜代表形式 ${point.base}｜意義分類 ${point.meaningName}｜異形 ${formsOf(
            point.id,
          ).join('、')}`,
      )
      .join('\n');

    let reply: string;
    try {
      reply = await collect(
        provider.stream({
          messages: [
            { role: 'system', content: SYSTEM },
            { role: 'user', content: lines },
          ],
          temperature: 0,
          format: FORMAT,
        }),
      );
    } catch (cause) {
      // An unreachable host is not a failed batch: stop, and leave the queue
      // for the next run to pick up whole.
      if (progress.glossed === 0) throw cause;
      break;
    }

    const wanted = new Set(batch.map((point) => point.id));
    let written = 0;
    try {
      const items = (JSON.parse(reply) as { items?: unknown }).items;
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item !== 'object' || item === null) continue;
          const { id, name, gloss } = item as Record<string, unknown>;
          if (typeof id !== 'string' || !wanted.has(id)) continue;
          if (typeof name !== 'string' || typeof gloss !== 'string') continue;
          if (!usable(name) || !usable(gloss)) continue;
          db.update(grammarPoints)
            .set({ nameZh: name.trim(), glossZh: gloss.trim(), glossModel: provider.model })
            .where(eq(grammarPoints.id, id))
            .run();
          written += 1;
        }
      }
    } catch {
      written = 0;
    }

    progress.glossed += written;
    progress.failed += batch.length - written;
    options?.onBatch?.(progress);

    // Nothing usable came back for a whole batch: the next loop would fetch
    // the same rows and ask the same question. Stop instead.
    if (written === 0) break;
  }

  return progress;
}

/** Points whose gloss came from a model and has not been reviewed by hand. */
export function unreviewedGlossCount(): number {
  return db
    .select({ id: grammarPoints.id })
    .from(grammarPoints)
    .where(and(isNull(grammarPoints.glossModel), isNull(grammarPoints.nameZh)))
    .all().length;
}
