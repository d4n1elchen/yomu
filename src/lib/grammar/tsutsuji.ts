/**
 * Reads 「つつじ」 into the shapes `match.ts` needs.
 *
 * No XML library, for the same reason `src/lib/epub/xhtml.ts` has none: the
 * document is machine-written, regular, and only four things are wanted from
 * it. つつじ's file is one `<ENTRIES>` of nine nested levels, each carrying
 * attributes that the levels below inherit -- so a stack of attribute frames
 * reads it in one pass, and a real parser would add a dependency to do exactly
 * that.
 *
 * What the levels mean, since the naming is not guessable:
 *
 *   L1 composition   L2 meaning        L3 grammatical function
 *   L4 alternation   L5 sound change   L6 inserted とりたて詞
 *   L7 conjugation   L8 です/ます      L9 spelling
 *
 * **L2 is the key.** Above it, meanings merge (ながら "while" with ながら
 * "although"); below it, everything is a way of writing the same point. Each L9
 * carries the written form; the id it hangs under truncates to its L2.
 */

import type {
  ConnectionTable,
  GrammarDifficulty,
  GrammarEntry,
  GrammarInventory,
  GrammarPattern,
} from './inventory.ts';

/** `<L4 L1to4ID="0011P.1" BASE="に.とっ.て">` and friends. */
const TAG = /<(\/?)(L[1-9])\b([^>]*)>/gu;
/** Names carry digits (`L1to2ID`) and namespaces (`jpt:ID`), so both are in. */
const ATTRIBUTE = /([A-Za-z][\w:.-]*)="([^"]*)"/gu;

/** Attributes inherited down the tree, and the ones that matter here. */
interface Frame {
  L2?: string;
  MCLASS?: string;
  DIFFICULTY?: string;
  BASE?: string;
  LEFT?: string;
  RIGHT?: string;
  UNCOMMON?: string;
}

function attributes(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of source.matchAll(ATTRIBUTE)) {
    // Namespaced ids (`jpt:ID`, `dsj:ID`) are cross-references to other
    // dictionaries and are not read: they name books this app does not have.
    if (name!.includes(':')) continue;
    out[name!] = value!;
  }
  return out;
}

const DIFFICULTIES = new Set(['A1', 'A2', 'B', 'C', 'F']);

function difficultyOf(value: string | undefined): GrammarDifficulty {
  // Unlabelled would be a data change, not a normal case. Treating it as the
  // hardest keeps it out of a reader's cards rather than into them unnoticed.
  return value !== undefined && DIFFICULTIES.has(value)
    ? (value as GrammarDifficulty)
    : 'F';
}

export interface TsutsujiSource {
  /** `tsutsuji1.1.xml`. */
  xml: string;
  /** `connectID`: connection class, TAB, semicolon-separated rows. */
  connectID: string;
  /** `className`: meaning class, TAB, its Japanese name. */
  className: string;
}

export interface ParsedTsutsuji extends GrammarInventory {
  /** Meaning class to its Japanese name, e.g. `J3` → 進行-継続-テイル類. */
  meaningNames: Record<string, string>;
}

/** `a\tb` per line, ignoring blank lines. Both side files are in this shape. */
function table(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab < 0) continue;
    out[line.slice(0, tab)] = line.slice(tab + 1);
  }
  return out;
}

export function parseTsutsuji(source: TsutsujiSource): ParsedTsutsuji {
  const entries = new Map<string, GrammarEntry>();
  const patterns: GrammarPattern[] = [];

  const stack: Frame[] = [];
  let frame: Frame = {};

  for (const match of source.xml.matchAll(TAG)) {
    const [, closing, level, rest] = match;

    if (closing) {
      frame = stack.pop() ?? {};
      continue;
    }

    const attrs = attributes(rest!);
    stack.push(frame);
    frame = { ...frame, ...attrs };

    if (level === 'L2') {
      const id = attrs['L1to2ID'];
      // A meaning with no id could not be filed under anything, so it is
      // dropped rather than given one -- an invented key is the failure this
      // whole design exists to avoid.
      if (id) {
        frame.L2 = id;
        entries.set(id, {
          id,
          base: (attrs['BASE'] ?? '').replaceAll('.', ''),
          difficulty: difficultyOf(frame.DIFFICULTY),
          meaningClass: attrs['MCLASS'] ?? '',
        });
      }
    }

    if (level === 'L9') {
      const l2 = frame.L2;
      // つつじ writes the form as its own text, dot-separated into the units a
      // morphological analyzer produces: `に.とっ.て`. The dots are the whole
      // reason this matches against tokens rather than against a string.
      const text = source.xml
        .slice(match.index + match[0].length)
        .split('<')[0]!
        .trim();
      const units = text.split('.').filter(Boolean);
      if (l2 && units.length > 0) {
        patterns.push({
          entryId: l2,
          units,
          left: frame.LEFT ?? null,
          right: frame.RIGHT ?? null,
        });
      }
    }

    // Levels below L9 do not exist; a self-closing tag would leave its frame
    // on the stack forever, and つつじ has none, but the guard is cheap.
    if (rest!.trimEnd().endsWith('/')) frame = stack.pop() ?? {};
  }

  const connections: ConnectionTable = {};
  for (const [code, rows] of Object.entries(table(source.connectID))) {
    connections[code] = rows.split(';').filter(Boolean);
  }

  return {
    entries: [...entries.values()],
    patterns,
    connections,
    meaningNames: table(source.className),
  };
}
