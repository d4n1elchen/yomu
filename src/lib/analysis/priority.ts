/**
 * Lets background analysis stand aside for a question the reader is waiting on.
 *
 * Ollama serves one request at a time for this model family (`qwen35` is pinned
 * to `numParallel = 1` whatever `OLLAMA_NUM_PARALLEL` says), and its queue is
 * FIFO. The drain and `/api/ask` share that one host, so a grammar question
 * asked mid-drain waits for the entry in flight to finish completely.
 *
 * Measured, rather than assumed: against 上がる -- 26 senses, a 9.0s translation
 * -- a question's time to first token went from 0.4s to 9.4s. It waited for the
 * whole entry. That is the difference between an answer that is thinking and one
 * that looks hung, which is the thing the streaming design exists to avoid.
 *
 * So interactive work announces itself here and the drain does two things:
 * declines to *start* another entry, and **abandons the one in flight**.
 *
 * Abandoning is the part that matters, and waiting alone is very nearly useless.
 * The drain awaits each entry, so it has a request outstanding essentially all
 * the time and a question almost always arrives mid-entry; FIFO already puts
 * that question ahead of the drain's next request, so declining to start one
 * saves nothing. The measured 9s is the *current* entry, and only dropping it
 * gives the time back.
 *
 * Dropping it is cheap precisely because the queues are derived: an abandoned
 * translation leaves `glossZh` null and an abandoned resolution leaves
 * `dictResolver` null, which is what they were before it started. The next drain
 * picks them up. The only cost is the model time already spent, which is a fair
 * trade for a reader watching a spinner.
 */

let inFlight = 0;

/**
 * Aborts the background request currently in flight, when there is one. A single
 * slot rather than a set: the drain is strictly sequential and never has two
 * outstanding.
 */
let abortBackground: (() => void) | null = null;

/** How often a waiting drain re-checks. Short enough to resume promptly once the
 *  answer is done, long enough not to spin. */
const POLL_MS = 100;

/**
 * A drain will not wait longer than this for the reader to finish.
 *
 * Insurance against a leaked counter, not a real timeout: every caller releases
 * in a `finally`, but a background pass that could stall forever on a mistake
 * elsewhere is a worse failure than one that occasionally overlaps a question.
 */
const MAX_WAIT_MS = 60_000;

/**
 * Marks interactive work as running, and returns the release.
 *
 * The release is idempotent so that a caller which both returns and throws --
 * an aborted stream ending in `finally` -- cannot drive the count negative and
 * leave the drain permanently convinced nobody is waiting.
 */
export function beginInteractive(): () => void {
  inFlight += 1;
  // Stand aside now rather than at the end of the current entry -- that entry is
  // the whole of the delay a reader feels.
  abortBackground?.();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    inFlight -= 1;
  };
}

/** Whether a reader is currently waiting on the model. */
export function interactiveInFlight(): boolean {
  return inFlight > 0;
}

/** Waits until no interactive request is running, or the cap expires. */
export async function yieldToInteractive(): Promise<void> {
  const until = Date.now() + MAX_WAIT_MS;
  while (inFlight > 0 && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/**
 * Registers the abort for a background request, and returns the deregister.
 *
 * The deregister only clears the slot if it still holds *this* request, so a
 * late unregister cannot detach the abort of a request that started after it.
 */
export function registerBackgroundRequest(abort: () => void): () => void {
  abortBackground = abort;
  return () => {
    if (abortBackground === abort) abortBackground = null;
  };
}

/**
 * Runs one background model request, abandoning it if a reader asks something
 * meanwhile. Returns null when it was abandoned -- which is not a failure, and
 * in particular is not the unreachable host that stops the whole drain.
 */
export async function runAbortable<T>(
  work: (signal: AbortSignal) => Promise<T>,
): Promise<{ value: T } | null> {
  // Do not even start if a question is already open.
  if (inFlight > 0) return null;

  const controller = new AbortController();
  const unregister = registerBackgroundRequest(() => controller.abort());
  try {
    return { value: await work(controller.signal) };
  } catch (cause) {
    if (controller.signal.aborted) return null;
    throw cause;
  } finally {
    unregister();
  }
}

/** Test seam: drops any outstanding count. Never call this from app code. */
export function resetInteractiveForTests(): void {
  inFlight = 0;
  abortBackground = null;
}
