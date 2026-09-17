/**
 * The grammar inventory: 「つつじ」 reduced to what matching needs.
 *
 * つつじ (Matsuyoshi & Sato, CC BY-SA 4.0) is a dictionary of Japanese
 * functional expressions -- 341 headwords, 435 meanings, 16,801 written forms
 * in a nine-level tree. The levels are exactly the variation that must collapse
 * into one learning item: spelling, です/ます, conjugation, inserted particles,
 * sound change, function-word alternation. The **L2** id is the level where
 * meanings separate (ながら "while" against ながら "although"), so it is the key
 * a card is filed under, and every written form reduces to it.
 *
 * Nothing here parses つつじ's XML: the import script does that and hands this
 * module the result, so matching can be tested without the gitignored `data/`.
 */

/**
 * つつじ's own difficulty grade, easiest first. `F` is undocumented in the
 * distribution; in practice it marks formal or archaic forms.
 */
export type GrammarDifficulty = 'A1' | 'A2' | 'B' | 'C' | 'F';

/** One grammar point: an L2 meaning, which is what a card and a card's key are. */
export interface GrammarEntry {
  /** つつじ's L1to2 id, e.g. `1351` for ～ている. */
  id: string;
  /** The representative written form, for display: ている, にとって. */
  base: string;
  difficulty: GrammarDifficulty;
  /**
   * The 意味的等価クラス: expressions that paraphrase each other (から / ので /
   * ものだから). Related, never merged -- they are what a card lists as similar
   * and what a quiz draws its wrong answers from.
   */
  meaningClass: string;
}

/**
 * One written form of one entry, split into the units the analyzer produces.
 *
 * `left` and `right` are つつじ's connection classes. `left` constrains the
 * token **before** the form; `right` constrains the form's own last token, which
 * is what tells ～ている (いる in 基本形) from the ～てい that a following た
 * leaves behind. Every code in the distribution is four characters and only the
 * first two carry meaning, so both are stored and read two characters wide.
 */
export interface GrammarPattern {
  /** The L2 id this form belongs to. */
  entryId: string;
  /** The form as analyzer-sized units: `['て', 'いる']`. */
  units: string[];
  left: string | null;
  right: string | null;
}

/**
 * A connection class resolves to IPADIC feature rows, and may name other
 * classes instead -- `b9` is "`10` or `2h`". Rows are IPADIC's seven fields
 * (pos, three details, conjugation type, conjugation form, base form), `*` as
 * the wildcard, and a row may stop early when the rest is wildcards.
 */
export type ConnectionTable = Record<string, string[]>;

export interface GrammarInventory {
  entries: GrammarEntry[];
  patterns: GrammarPattern[];
  connections: ConnectionTable;
}

/** A connection class that constrains nothing: つつじ's "any token". */
const ANY = '90';

/** Only the first two characters of a connection code are meaningful. */
function classOf(code: string): string {
  return code.slice(0, 2);
}

export interface CompiledInventory {
  entry(id: string): GrammarEntry | undefined;
  /**
   * Every form beginning with this surface. Matching walks the token stream and
   * asks this once per token, rather than scanning 16,801 forms.
   */
  startingWith(surface: string): readonly GrammarPattern[];
  /** Whether a token satisfies a connection code. */
  accepts(code: string | null, token: FeatureToken): boolean;
}

/** The analyzer's output, narrowed to the fields a connection row compares. */
export interface FeatureToken {
  lemma: string;
  pos: string;
  features: {
    posDetail1: string;
    posDetail2: string;
    posDetail3: string;
    conjugatedType: string;
    conjugatedForm: string;
  };
}

/** The seven fields a connection row is written in, in IPADIC's order. */
function fieldsOf(token: FeatureToken): string[] {
  return [
    token.pos,
    token.features.posDetail1,
    token.features.posDetail2,
    token.features.posDetail3,
    token.features.conjugatedType,
    token.features.conjugatedForm,
    token.lemma,
  ];
}

/**
 * Flattens a connection class to feature rows, following references to other
 * classes. The `seen` set is not defensive tidiness: the table is data from a
 * file, and a cycle in it would otherwise hang an import.
 */
function resolve(
  table: ConnectionTable,
  code: string,
  seen: Set<string>,
): string[][] {
  if (seen.has(code)) return [];
  seen.add(code);

  const rows: string[][] = [];
  for (const item of table[code] ?? []) {
    if (item.length === 2 && table[item]) rows.push(...resolve(table, item, seen));
    else rows.push(item.split(','));
  }
  return rows;
}

/**
 * Indexes an inventory for matching. Every form is filed under its first unit,
 * and every connection class is flattened once rather than on each comparison.
 */
export function compileInventory(inventory: GrammarInventory): CompiledInventory {
  const entries = new Map(inventory.entries.map((entry) => [entry.id, entry]));

  const byFirst = new Map<string, GrammarPattern[]>();
  for (const pattern of inventory.patterns) {
    const first = pattern.units[0];
    if (first === undefined) continue;
    const list = byFirst.get(first);
    if (list) list.push(pattern);
    else byFirst.set(first, [pattern]);
  }

  const classes = new Map<string, string[][]>();
  for (const code of Object.keys(inventory.connections)) {
    classes.set(code, resolve(inventory.connections, code, new Set()));
  }

  return {
    entry: (id) => entries.get(id),
    startingWith: (surface) => byFirst.get(surface) ?? [],
    accepts(code, token) {
      if (code === null) return true;
      const key = classOf(code);
      if (key === ANY) return true;

      const rows = classes.get(key);
      // An unknown class admits everything rather than nothing: the table is
      // data, and a missing row must not silently delete a grammar point.
      if (rows === undefined || rows.length === 0) return true;

      const fields = fieldsOf(token);
      return rows.some((row) =>
        row.every((want, i) => want === '*' || want === fields[i]),
      );
    },
  };
}
