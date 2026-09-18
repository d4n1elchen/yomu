/**
 * Finds the grammar points in one sentence.
 *
 * This is the deterministic half of the grammar flow: it proposes, the model
 * disposes. Every form in the inventory is written in the analyzer's own units
 * and carries IPADIC connection constraints, so candidates come off the token
 * stream the reader already has -- no patterns to author, and no second
 * tokenizer. What it cannot do is decide: 目**にして**いた is the verb する and
 * 嫌な感じ**では**なかった is the copula, and both match. Measured on 200
 * labelled spans from the library, taking the first candidate blindly is right
 * 60% of the time. The model is asked afterwards, and only about what this
 * returns.
 *
 * It is pure and takes its inventory as an argument, so it is testable without
 * the gitignored `data/` つつじ lives in.
 */

import type { CompiledInventory, FeatureToken } from './inventory.ts';

/**
 * What matching needs from a token. Both the analyzer's `AnalyzedToken` and a
 * `token` row satisfy it, which is the point: the same code runs at import time
 * and on a stored sentence.
 */
export interface MatchToken extends FeatureToken {
  surface: string;
  charStart: number;
  charEnd: number;
}

/** One place in the sentence where the inventory has something to say. */
export interface GrammarMatch {
  /**
   * Every L2 id whose form matched here, in inventory order. More than one
   * means the form is written the same for several meanings -- ために "because"
   * and ために "in order to" -- which is the model's question, not this one's.
   */
  entryIds: string[];
  /** Token indices, `end` exclusive. */
  start: number;
  end: number;
  /** Offsets into the sentence text, for marking the span in the card. */
  charStart: number;
  charEnd: number;
  /** The matched text as written, e.g. `てい` in ～ていた. */
  surface: string;
}

/**
 * The imaginary token before the first one. Nothing satisfies a real feature
 * row, so a form that requires anything to its left cannot match at the start
 * of a sentence, while `90` ("any") still can.
 */
const START: FeatureToken = {
  lemma: '',
  pos: '',
  features: {
    posDetail1: '',
    posDetail2: '',
    posDetail3: '',
    conjugatedType: '',
    conjugatedForm: '',
  },
};

/**
 * Matches every form, then keeps the longest ones that do not overlap.
 *
 * The longest-match rule is a fix for something measured: 帰ら**なければ**いけない
 * offered only ～ないと ("unless"), because the shorter form matched first and
 * the model then had nothing right to choose. Ten of eighteen wrong picks in
 * that run were this. Longest-first also settles ようにし against にして in
 * ようにしている, where the two overlap without either containing the other:
 * same length, so the one that starts earlier wins and the other is dropped.
 *
 * Overlapping is resolved rather than reported because a card is a thing you
 * add, and two cards claiming the same characters would mean the same sentence
 * teaching two different things about them.
 */
export function matchSentence(
  tokens: MatchToken[],
  inventory: CompiledInventory,
): GrammarMatch[] {
  const found = new Map<string, GrammarMatch>();

  for (let i = 0; i < tokens.length; i++) {
    for (const pattern of inventory.startingWith(tokens[i]!.surface[0]!)) {
      const written = pattern.units.join('');

      // The two dictionaries cut words in different places -- つつじ writes
      // に.とっ.て, IPADIC has にとって whole -- so the form is compared against
      // the run of surfaces rather than unit against token. The run must come
      // out exactly: a form may cover several tokens or sit inside one, but it
      // may never end halfway through a token, because the span has to be
      // something the reader can be shown.
      let end = i;
      let run = '';
      while (end < tokens.length && run.length < written.length) {
        run += tokens[end]!.surface;
        end += 1;
      }
      if (run !== written) continue;

      // `left` describes the token before the form. At the start of a sentence
      // there is none, and only a form that constrains nothing may match there:
      // ～ては cannot open a sentence.
      const before = tokens[i - 1];
      if (before ? !inventory.accepts(pattern.left, before) : !inventory.accepts(pattern.left, START)) {
        continue;
      }
      // `right` constrains the form's last unit, which only exists as a token
      // when the analyzer cut the form the same way つつじ does. Where it
      // merged them -- にとって as one 連語 -- there is nothing to test, and
      // testing the merged token instead would reject the form for not being
      // its own last morpheme.
      const last = tokens[end - 1]!;
      const cut = last.surface === pattern.units.at(-1);
      if (cut && !inventory.accepts(pattern.right, last)) continue;

      const key = `${i}-${end}`;
      const match = found.get(key);
      if (match) {
        if (!match.entryIds.includes(pattern.entryId)) {
          match.entryIds.push(pattern.entryId);
        }
        continue;
      }
      found.set(key, {
        entryIds: [pattern.entryId],
        start: i,
        end,
        charStart: tokens[i]!.charStart,
        charEnd: tokens[end - 1]!.charEnd,
        surface: tokens
          .slice(i, end)
          .map((token) => token.surface)
          .join(''),
      });
    }
  }

  const ranked = [...found.values()].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );

  const kept: GrammarMatch[] = [];
  const shelved: GrammarMatch[] = [];
  for (const match of ranked) {
    const clashes = kept.some((other) => match.start < other.end && other.start < match.end);
    if (clashes) shelved.push(match);
    else kept.push(match);
  }

  // Forms chain on a shared joint, and dropping the second one loses a real
  // point. ～ようにしている is ～ようにする in て-form plus ～ている, and the て
  // belongs to both: greedy keeps よう.に.し.て and ている then has nowhere to
  // start. Measured over 800 sentences, this was eleven losses, nearly all of
  // them ～ている -- the commonest point there is.
  //
  // So a shelved span is readmitted when its only overlap is that one joint:
  // it begins exactly where a kept span ends, on the token they share, and
  // clashes with nothing else. Anything overlapping more deeply stays out,
  // because two cards would then be claiming the same words.
  for (const match of shelved) {
    const joins = kept.some(
      (other) => other.end - 1 === match.start && other.start < match.start,
    );
    if (!joins) continue;
    const overlapsMore = kept.some(
      (other) => match.start < other.end - 1 && other.start < match.end,
    );
    if (overlapsMore) continue;
    kept.push(match);
  }

  return kept.sort((a, b) => a.start - b.start || a.end - b.end);
}
