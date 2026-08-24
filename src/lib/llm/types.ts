export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  temperature?: number;
  /**
   * A JSON schema constraining the reply to structured output -- Ollama's
   * `format` field. When set, the model must emit JSON matching it, which is how
   * translation and homograph resolution get an answer that parses instead of
   * prose to scrape. Left unset for streamed prose like Q&A, where the reader is
   * the parser.
   */
  format?: unknown;
  signal?: AbortSignal;
}

/**
 * Providers stream, because a 27B model takes tens of seconds to answer and a
 * silent spinner for that long reads as a hang. Callers that want the whole
 * answer can collect the stream.
 */
export interface LlmProvider {
  /** Recorded on every answer, so a stored explanation is attributable. */
  readonly id: string;
  readonly model: string;
  stream(request: LlmRequest): AsyncIterable<string>;
}

export async function collect(chunks: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const chunk of chunks) out += chunk;
  return out;
}
