import { createFallbackProvider } from './fallback.ts';
import { createOllamaProvider } from './ollama.ts';
import type { LlmProvider } from './types.ts';

export type { LlmMessage, LlmProvider, LlmRequest } from './types.ts';
export { collect } from './types.ts';

/**
 * Tried in order: the first that answers wins. The cloud model is fast and runs
 * off the box; qwen3.8:27b is local, measured, and there when the cloud is not.
 */
export const DEFAULT_MODELS = ['glm-5.3-flash:cloud', 'qwen3.8:27b'];

/**
 * `YOMU_LLM_MODELS`, comma-separated, or the default list.
 *
 * The old single `YOMU_LLM_MODEL` is ignored rather than honoured: every
 * `.env.local` copied from the example pinned it to qwen3.8:27b, and honouring
 * it would have quietly kept each machine off the fallback list. It is named in
 * a warning so a deliberate setting is not lost without a word.
 */
export function configuredModels(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const listed = (env.YOMU_LLM_MODELS ?? '')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return listed.length > 0 ? listed : DEFAULT_MODELS;
}

let warnedLegacy = false;

/**
 * Ollama today, other providers later. Everything the app needs from an LLM
 * goes through this interface, and no key or host ever reaches the client --
 * only server code calls it.
 */
export function getLlmProvider(): LlmProvider {
  const provider = process.env.YOMU_LLM_PROVIDER ?? 'ollama';
  const models = configuredModels();
  if (process.env.YOMU_LLM_MODEL && !warnedLegacy) {
    warnedLegacy = true;
    console.warn(
      `[llm] YOMU_LLM_MODEL is no longer read; using YOMU_LLM_MODELS=${models.join(',')}.`,
    );
  }

  switch (provider) {
    case 'ollama': {
      const providers = models.map((model) =>
        createOllamaProvider({ baseUrl: process.env.YOMU_OLLAMA_URL, model }),
      );
      return providers.length === 1 ? providers[0]! : createFallbackProvider(providers);
    }
    default:
      throw new Error(
        `Unknown YOMU_LLM_PROVIDER "${provider}". Supported: ollama.`,
      );
  }
}
