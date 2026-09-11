import type { LlmProvider, LlmRequest } from './types.ts';

const DEFAULT_URL = 'http://127.0.0.1:11434';

interface ChatChunk {
  message?: { content?: string };
  done?: boolean;
  error?: string;
}

/**
 * What actually went wrong, dug out of `fetch`'s cause.
 *
 * A connection that never lands rejects as `TypeError: fetch failed`, and every
 * fact that distinguishes one failure from another -- refused, timed out, no
 * such host -- sits a level down in `cause.code`. The reader sees this text:
 * once an answer has begun streaming the status code is already sent, so
 * `/api/ask` writes the failure into the body. "fetch failed" told them nothing,
 * not even which host had not answered.
 */
export function describeCause(error: unknown): string {
  const cause = (error as { cause?: unknown })?.cause;
  const code = (cause as { code?: unknown })?.code;

  if (typeof code === 'string') {
    if (code === 'ECONNREFUSED') return '主機拒絕連線';
    if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
      return '連線逾時';
    }
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '找不到主機';
    if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '網路無法到達';
    return code;
  }
  if (cause instanceof Error && cause.message) return cause.message;
  return error instanceof Error ? error.message : String(error);
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
      let response: Response;

      try {
        response = await fetch(`${baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          signal: request.signal,
          body: JSON.stringify({
            model: options.model,
            stream: true,
            // These models emit a long private reasoning block by default, which
            // the reader never sees but still waits for.
            think: false,
            // A JSON schema when the caller wants structured output;
            // JSON.stringify drops the key when it is undefined, so prose
            // requests are unaffected.
            format: request.format,
            options: { temperature: request.temperature ?? 0.3 },
            messages: request.messages,
          }),
        });
      } catch (cause) {
        // An abort is the caller standing the request down -- a reader closing
        // the card, or the drain giving way to a question. It has to stay an
        // abort: `runAbortable` tells that apart from a dead host, and only a
        // dead host stops the drain.
        if (request.signal?.aborted) throw cause;
        throw new Error(
          `連不上 Ollama（${baseUrl}）：${describeCause(cause)}。` +
            '請確認該主機正在執行，或檢查 YOMU_OLLAMA_URL。',
          { cause },
        );
      }

      if (!response.ok || !response.body) {
        throw new Error(
          `Ollama 回應 ${response.status} ${response.statusText}（${baseUrl}）。` +
            `請確認 YOMU_OLLAMA_URL 與模型名稱 ${options.model} 是否正確。`,
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
