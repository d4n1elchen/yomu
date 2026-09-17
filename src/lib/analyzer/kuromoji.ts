import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import kuromoji from 'kuromoji';
import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import type { AnalyzedToken, Analyzer } from './types.ts';

type Tk = Tokenizer<IpadicFeatures>;

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

let tokenizerPromise: Promise<Tk> | null = null;

/**
 * Cold init reads the dictionary off disk. Paying that once per process is
 * fine; paying it per request is not -- which is the whole of what kuromojin
 * used to provide, minus a result cache we never read and a promise wrapper
 * that latched `isLoading` on failure and never cleared it.
 *
 * A failed build drops the cached promise, so fixing the dictionary path
 * recovers on the next request instead of requiring a server restart.
 */
function tokenizer(): Promise<Tk> {
  tokenizerPromise ??= new Promise<Tk>((resolve, reject) => {
    // dicPath() throws when the dictionary is missing; inside the executor
    // that surfaces as a rejection like any other build failure.
    kuromoji.builder({ dicPath: dicPath() }).build((error, tk) => {
      if (error) reject(error);
      else resolve(tk);
    });
  }).catch((error: unknown) => {
    tokenizerPromise = null;
    throw error;
  });
  return tokenizerPromise;
}

/**
 * IPADIC gives the reading of the *surface* -- 食べた is segmented into 食べ
 * (タベ) and た, so the verb token's reading is タベ. A lexeme is keyed on its
 * dictionary form, whose reading is タベル. Using the surface reading here
 * would file every inflection as a separate Dictionary entry -- exactly what
 * grouping inflections under one dictionary form is meant to prevent. So the
 * lemma is run back through the tokenizer to read it properly, memoized
 * because an article has far fewer distinct lemmas than tokens.
 */
const lemmaReadings = new Map<string, string>();

function readLemma(tk: Tk, lemma: string): string {
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
 * kuromoji's own `word_position` is not trusted, for two reasons.
 *
 * It counts CODE POINTS, while JavaScript string indexes are UTF-16 code units,
 * so an astral character -- a rare kanji like 𠮷 or 𩸽, or an emoji -- slid
 * every later offset by one per surrogate pair.
 *
 * And it is wrong on its own terms. The tokenizer splits its input after every
 * 、 and 。 and places each piece at the START of the previous piece's last
 * token, which is only the end of that piece while the token is the lone mark.
 * An unknown symbol groups with the mark after it -- 〝補佐〟。 ends in the one
 * token 〟。 -- and from there every offset in the chapter came out a character
 * early per grouping: sentences opened with the previous 。 and lost their own.
 *
 * The surfaces, though, are exact substrings and cover the input end to end.
 * So each token is placed where the previous one ended, in UTF-16 units, and a
 * surface that is not found there throws rather than writing a wrong offset.
 */
function convert(tk: Tk, token: IpadicFeatures, charStart: number): AnalyzedToken {
  const surface = token.surface_form;
  // Unknown words (names, rare kanji, neologisms) have no dictionary form.
  const lemma = value(token.basic_form) ?? surface;
  const reading = value(token.reading);

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
    charEnd: charStart + surface.length,
  };
}

/** The marks kuromoji splits its input at, and the ones sentences end on. */
const PUNCTUATION = /([、。])/u;

/**
 * 〟。 as one token hides the 。 from sentence segmentation, which looks for a
 * terminator token, so the sentence ran on into the next one. An unknown token
 * holding a mark is cut around it and each piece tokenized alone, so the mark
 * gets IPADIC's own 句点 or 読点 entry rather than one invented here. Known words
 * never contain one; only unknown grouping produces this.
 */
function separatePunctuation(tk: Tk, token: IpadicFeatures): IpadicFeatures[] {
  const surface = token.surface_form;
  if (token.word_type !== 'UNKNOWN' || surface.length < 2 || !PUNCTUATION.test(surface)) {
    return [token];
  }
  return surface
    .split(PUNCTUATION)
    .filter((piece) => piece !== '')
    .flatMap((piece) => tk.tokenize(piece));
}

export const kuromojiAnalyzer: Analyzer = {
  id: 'kuromoji-ipadic',
  version: '0.1.2',
  dictionary: 'ipadic',

  async analyze(text: string): Promise<AnalyzedToken[]> {
    if (text.length === 0) return [];
    const tk = await tokenizer();
    const analyzed: AnalyzedToken[] = [];
    let cursor = 0;
    for (const token of tk.tokenize(text).flatMap((t) => separatePunctuation(tk, t))) {
      if (!text.startsWith(token.surface_form, cursor)) {
        throw new Error(
          `kuromoji returned ${JSON.stringify(token.surface_form)} where the text ` +
            `has ${JSON.stringify(text.slice(cursor, cursor + 10))} (offset ${cursor}).`,
        );
      }
      analyzed.push(convert(tk, token, cursor));
      cursor += token.surface_form.length;
    }
    return analyzed;
  },
};
