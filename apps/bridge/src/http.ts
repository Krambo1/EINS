/**
 * Shared fetch wrapper with a hard wall-clock timeout (H15).
 *
 * The server half had zero AbortSignal usage: a single black-holed TCP
 * connection made a `fetch` hang forever. In the scheduler that stalls the
 * whole tick (the next tick is scheduled in `finally` after the current one
 * completes), so ALL polling for ALL Praxen stops silently; in a webhook
 * handler it hangs past the vendor's delivery timeout.
 *
 * Every outbound fetch in apps/bridge/src goes through this helper so a stuck
 * connection surfaces as a normal retriable TimeoutError instead of a hang.
 * `AbortSignal.timeout` timers do not keep the Node process alive, so the
 * pending timers are harmless if the request settles first.
 */

export const FETCH_TIMEOUT_MS = 30_000;

export function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<Response> {
  // A caller-supplied signal (scheduler deadline / shutdown) is COMBINED with
  // the per-request timeout, so cancelling the work aborts the in-flight fetch
  // and a stuck connection still times out on its own.
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  // Reference the global at call time so test doubles that replace
  // globalThis.fetch are still honored.
  return fetch(input, { ...init, signal });
}
