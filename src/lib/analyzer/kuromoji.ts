import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getTokenizer, type KuromojiToken, type Tokenizer } from 'kuromojin';
import type { AnalyzedToken, Analyzer } from './types.ts';

/**
 * Anchored to the project's package.json on disk rather than to
 * `import.meta.url`. Turbopack rewrites module URLs for externalized packages
 * into virtual `[externals]/...` paths, and resolving against one of those
 * yields a directory that does not exist.
 */
const requireFromProject = createRequire(
  pathToFileURL(path.join(process.cwd(), 'package.json')),
);

/** IPADIC writes '*' where it has no value. */
const EMPTY = '*';
const value = (raw: string | undefined): string | null =>
  raw && raw !== EMPTY ? raw : null;

/**
 * kuromoji reads its .dat.gz dictionary through Node fs, so the path has to
 * point at the real node_modules layout. Getting this wrong surfaces as an
 * ENOENT deep inside the tokenizer, so it is checked here where the message
 * can say what actually went wrong.
 */
function dicPath(): string {
  const override = process.env.KUROMOJI_DIC_PATH;
  const dir =
    override ??
    path.join(
      path.dirname(requireFromProject.resolve('kuromoji/package.json')),
      'dict',
    );

  if (!existsSync(path.join(dir, 'base.dat.gz'))) {
    throw new Error(
      `kuromoji dictionary not found at ${dir}. Set KUROMOJI_DIC_PATH to the ` +
        `directory holding base.dat.gz, or reinstall the kuromoji package.`,
    );
  }
  return dir;
}

let tokenizerPromise: Promise<Tokenizer> | null = null;

/**
 * Cold init reads the dictionary off disk. Paying that once per process is
 * fine; paying it per request is not.
 *
 * The dictionary path is validated before kuromojin is ever called, because
 * kuromojin latches `isLoading` on its first attempt and never clears it on
 * failure -- one bad build leaves it returning the same rejected promise for
 * the life of the process. Dropping our own cached rejection at least keeps
 * the real error visible on every request instead of a stale one.
 */
function tokenizer(): Promise<Tokenizer> {
  tokenizerPromise ??= getTokenizer({ dicPath: dicPath() }).catch((error) => {
    tokenizerPromise = null;
    throw error;
  });
  return tokenizerPromise;
}

/**
 * IPADIC gives the reading of the *surface* (食べた -> タベタ), but a lexeme is
 * keyed on its dictionary form, whose reading is タベル. Using the surface
 * reading here would file every inflection as a separate library entry --
 * exactly what grouping inflections under one dictionary form is meant to
 * prevent. So the lemma is run back through the tokenizer to read it properly,
 * memoized because a lesson has far fewer distinct lemmas than tokens.
 */
const lemmaReadings = new Map<string, string>();

function readLemma(tk: Tokenizer, lemma: string): string {
  const cached = lemmaReadings.get(lemma);
  if (cached !== undefined) return cached;

  let reading = '';
  try {
    const parts = tk.tokenize(lemma);
    const readings = parts.map((p) => value(p.reading));
    // Partial readings would produce a misleading key; prefer none at all.
    reading = readings.every((r) => r !== null) ? readings.join('') : '';
  } catch {
    reading = '';
  }
  lemmaReadings.set(lemma, reading);
  return reading;
}

/**
 * kuromoji counts `word_position` in CODE POINTS, while JavaScript string
 * indexes are UTF-16 code units. They agree until the text contains an astral
 * character -- a rare kanji like 𠮷 or 𩸽, or an emoji -- and from there every
 * offset silently slides by one per surrogate pair, corrupting sentence text
 * and word selection for the rest of the document.
 *
 * Returns a code-point index -> UTF-16 index table, or null when the text is
 * entirely in the BMP and the two are identical.
 */
function codePointOffsets(text: string): number[] | null {
  // Deliberately not /u: in Unicode mode a well-formed surrogate pair is
  // matched as its combined code point, so the surrogate range never hits.
  if (!/[\uD800-\uDBFF]/.test(text)) return null;
  const map: number[] = [];
  for (let i = 0; i < text.length; ) {
    map.push(i);
    i += text.codePointAt(i)! > 0xffff ? 2 : 1;
  }
  map.push(text.length);
  return map;
}

function convert(
  tk: Tokenizer,
  token: KuromojiToken,
  offsets: number[] | null,
  textLength: number,
): AnalyzedToken {
  const surface = token.surface_form;
  // Unknown words (names, rare kanji, neologisms) have no dictionary form.
  const lemma = value(token.basic_form) ?? surface;
  const reading = value(token.reading);

  // word_position is 1-based.
  const cpStart = token.word_position - 1;
  let charStart: number;
  let charEnd: number;
  if (offsets) {
    const cpLength = [...surface].length;
    charStart = offsets[cpStart] ?? textLength;
    charEnd = offsets[cpStart + cpLength] ?? textLength;
  } else {
    charStart = cpStart;
    charEnd = cpStart + surface.length;
  }

  return {
    surface,
    lemma,
    lemmaReading:
      lemma === surface ? (reading ?? '') : readLemma(tk, lemma),
    reading,
    pos: token.pos,
    features: {
      posDetail1: token.pos_detail_1,
      posDetail2: token.pos_detail_2,
      posDetail3: token.pos_detail_3,
      conjugatedType: token.conjugated_type,
      conjugatedForm: token.conjugated_form,
      wordType: token.word_type,
    },
    charStart,
    charEnd,
  };
}

export const kuromojiAnalyzer: Analyzer = {
  id: 'kuromoji-ipadic',
  version: '0.1.2',
  dictionary: 'ipadic',

  async analyze(text: string): Promise<AnalyzedToken[]> {
    if (text.length === 0) return [];
    const tk = await tokenizer();
    const offsets = codePointOffsets(text);
    return tk
      .tokenize(text)
      .map((token) => convert(tk, token, offsets, text.length));
  },
};
