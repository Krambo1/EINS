import { describe, it, expect, afterEach } from "vitest";
import { fetchWithTimeout, FETCH_TIMEOUT_MS } from "./http.js";

/**
 * H15: every server-side fetch must carry an AbortSignal so a black-holed
 * connection surfaces as a retriable error instead of hanging forever.
 */
describe("fetchWithTimeout", () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("aborts a fetch that never resolves, within the injected timeout", async () => {
    // A fetch impl that only settles when its AbortSignal fires (models a
    // hung/black-holed connection that the runtime aborts on timeout).
    globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const sig = init?.signal;
        if (!sig) return; // never settles → the test would time out if no signal
        sig.addEventListener("abort", () =>
          reject(sig.reason ?? new Error("aborted"))
        );
      })) as typeof fetch;

    const started = Date.now();
    await expect(fetchWithTimeout("https://black.hole", {}, 25)).rejects.toBeDefined();
    // Settles from the abort, not from a hang.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it("passes an AbortSignal to fetch by default", async () => {
    let seen: RequestInit | undefined;
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response("{}"));
    }) as typeof fetch;
    await fetchWithTimeout("https://ok.test");
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults to a 30s budget", () => {
    expect(FETCH_TIMEOUT_MS).toBe(30_000);
  });
});
