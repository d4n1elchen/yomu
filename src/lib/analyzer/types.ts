export interface TokenFeatures {
  posDetail1: string;
  posDetail2: string;
  posDetail3: string;
  conjugatedType: string;
  conjugatedForm: string;
  wordType: string;
}

export interface AnalyzedToken {
  /** The inflected form exactly as written. */
  surface: string;
  /** Dictionary form. Falls back to the surface when the analyzer has none. */
  lemma: string;
  /** Katakana reading of the LEMMA -- part of the lexeme identity. */
  lemmaReading: string;
  /** Katakana reading of THIS surface. Null when the analyzer has none. */
  reading: string | null;
  /** Coarse part of speech (名詞, 動詞, ...). */
  pos: string;
  features: TokenFeatures;
  /** Offsets into the text passed to `analyze`. */
  charStart: number;
  charEnd: number;
}

/**
 * The analyzer owns segmentation, readings, and dictionary forms; the LLM owns
 * grammar and nuance. This interface deliberately mirrors the shape the LLM
 * provider abstraction will take -- swapping IPADIC for UniDic should be a
 * one-file change plus a re-tokenize, not a refactor.
 */
export interface Analyzer {
  /** Stable identifier recorded on every section, e.g. 'kuromoji-ipadic'. */
  readonly id: string;
  readonly version: string;
  /** Namespaces lexeme identity, so two dictionaries never silently merge. */
  readonly dictionary: string;
  analyze(text: string): Promise<AnalyzedToken[]>;
}
