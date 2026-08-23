import { createOllamaProvider } from './ollama.ts';
import type { LlmProvider } from './types.ts';

export type { LlmMessage, LlmProvider, LlmRequest } from './types.ts';
export { collect } from './types.ts';

/**
 * Ollama today, other providers later. Everything the app needs from an LLM
 * goes through this interface, and no key or host ever reaches the client --
 * only server code calls it.
 */
export function getLlmProvider(): LlmProvider {
  const provider = process.env.YOMU_LLM_PROVIDER ?? 'ollama';
  const model = process.env.YOMU_LLM_MODEL ?? 'qwen3.8:27b';

  switch (provider) {
    case 'ollama':
      return createOllamaProvider({
        baseUrl: process.env.YOMU_OLLAMA_URL,
        model,
      });
    default:
      throw new Error(
        `Unknown YOMU_LLM_PROVIDER "${provider}". Supported: ollama.`,
      );
  }
}
