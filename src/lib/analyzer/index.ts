import { kuromojiAnalyzer } from './kuromoji.ts';
import type { Analyzer } from './types.ts';

export type { AnalyzedToken, Analyzer, TokenFeatures } from './types.ts';

/**
 * One analyzer for now. The indirection exists so that switching to UniDic
 * later is a change here plus a re-tokenize, and so that `analyzerId` /
 * `dictionary` are always recorded from a single source of truth.
 */
export function getAnalyzer(): Analyzer {
  return kuromojiAnalyzer;
}
