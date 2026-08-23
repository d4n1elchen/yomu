import type { LlmProvider, LlmRequest } from './types.ts';

const DEFAULT_URL = 'http://127.0.0.1:11434';

interface ChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

export function createOllamaProvider(options: {
  baseUrl?: string;
  model: string;
}): LlmProvider {
  const baseUrl = (options.baseUrl || DEFAULT_URL).replace(/\/+$/, '');

  return {
    id: `ollama:${baseUrl}`,
    model: options.model,

    async *stream(request: LlmRequest): AsyncIterable<string> {
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: request.signal,
        body: JSON.stringify({
          model: options.model,
          stream: true,
          // These models emit a long private reasoning block by default, which
          // the reader never sees but still waits for.
          think: false,
          options: { temperature: request.temperature ?? 0.3 },
          messages: request.messages,
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(
          `Ollama ${response.status} ${response.statusText} at ${baseUrl}. ` +
            `Check YOMU_OLLAMA_URL and that the host is reachable.`,
        );
      }

      // Ollama streams newline-delimited JSON, and a chunk can split a line.
      const decoder = new TextDecoder();
      let buffer = '';

      for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(bytes, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: ChatChunk;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (parsed.error) throw new Error(`Ollama: ${parsed.error}`);
          const text = parsed.message?.content;
          if (text) yield text;
          if (parsed.done) return;
        }
      }
    },
  };
}
