import { collect, type LlmProvider, type LlmRequest } from './types.ts';

/**
 * How long a model that just failed is skipped before it is tried again.
 *
 * A cloud model that is down tends to stay down for a while, and a host that
 * times out costs the whole timeout on every request. Without this each
 * question would pay for the dead model before reaching the live one.
 */
export const COOLDOWN_MS = 60_000;

/**
 * Keyed on provider and model, and module-wide rather than per provider:
 * `getLlmProvider()` builds a fresh provider for each caller, and what one
 * learned about a dead model should spare the next.
 */
const coolingUntil = new Map<string, number>();

const keyOf = (provider: LlmProvider) => `${provider.id}\n${provider.model}`;

/**
 * Tries each provider in order, moving to the next only when one fails
 * **before its first chunk**.
 *
 * After the first chunk the answer is already on the reader's screen, and a
 * second model continuing it would splice two voices into one answer -- so a
 * failure mid-stream is thrown, as it always was. An abort is never a reason to
 * fall back either: it is the caller standing the request down.
 *
 * A **structured** request (`format` set) is collected whole before anything
 * is yielded, and a reply that is not JSON counts as a failure: those callers
 * collect the stream anyway, and a model that answers in prose instead of the
 * schema has not answered. That failure does not start a cooldown -- the model
 * is up, and may do fine with the next prose question. If no model manages
 * JSON, the last reply is returned as it came: the caller already handles an
 * unreadable answer, and an exception would read to it as an unreachable host.
 *
 * `model` reports whichever model answered this provider's latest request, so
 * the callers that record attribution after a call (a translation's
 * `glossModel`, a resolution's `dictResolver`) name the one that really wrote
 * it. Each caller holds its own provider and calls it one request at a time,
 * which is what makes that safe.
 */
export function createFallbackProvider(
  providers: LlmProvider[],
  options: { cooldownMs?: number; now?: () => number } = {},
): LlmProvider {
  if (providers.length === 0) throw new Error('At least one model is required.');
  const cooldownMs = options.cooldownMs ?? COOLDOWN_MS;
  const now = options.now ?? Date.now;
  let answeredBy = providers[0]!.model;

  return {
    id: providers.map((p) => p.id).join('|'),
    get model() {
      return answeredBy;
    },
    models: providers.map((p) => p.model),

    async *stream(request: LlmRequest): AsyncIterable<string> {
      // A cooling model is skipped only while another is available: when every
      // one has failed recently, trying them all beats failing unasked.
      const ready = providers.filter((p) => (coolingUntil.get(keyOf(p)) ?? 0) <= now());
      const order = ready.length > 0 ? ready : providers;

      let lastError: unknown;
      let lastProse: { model: string; reply: string } | null = null;
      for (const provider of order) {
        if (request.format !== undefined) {
          let reply: string;
          try {
            reply = await collect(provider.stream(request));
          } catch (error) {
            if (request.signal?.aborted) throw error;
            lastError = error;
            coolingUntil.set(keyOf(provider), now() + cooldownMs);
            warnFallback(provider, order, error);
            continue;
          }
          if (!isJson(reply)) {
            lastProse = { model: provider.model, reply };
            warnFallback(provider, order, new Error('did not answer in JSON'));
            continue;
          }
          answeredBy = provider.model;
          coolingUntil.delete(keyOf(provider));
          yield reply;
          return;
        }

        let started = false;
        try {
          for await (const chunk of provider.stream(request)) {
            if (!started) {
              started = true;
              answeredBy = provider.model;
            }
            yield chunk;
          }
          if (!started) answeredBy = provider.model;
          coolingUntil.delete(keyOf(provider));
          return;
        } catch (error) {
          if (started || request.signal?.aborted) throw error;
          lastError = error;
          coolingUntil.set(keyOf(provider), now() + cooldownMs);
          warnFallback(provider, order, error);
        }
      }
      if (lastProse) {
        answeredBy = lastProse.model;
        yield lastProse.reply;
        return;
      }
      throw lastError;
    },
  };
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function warnFallback(provider: LlmProvider, order: LlmProvider[], error: unknown): void {
  const next = order[order.indexOf(provider) + 1];
  if (!next) return;
  console.warn(
    `[llm] ${provider.model} failed, falling back to ${next.model}:`,
    error instanceof Error ? error.message : error,
  );
}

/** Test seam: forgets every cooldown. Never call this from app code. */
export function resetCooldownsForTests(): void {
  coolingUntil.clear();
}
