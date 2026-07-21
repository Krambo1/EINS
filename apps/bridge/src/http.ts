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
  // Reference the global at call time so test doubles that replace
  // globalThis.fetch are still honored.
  return fetch(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
}
