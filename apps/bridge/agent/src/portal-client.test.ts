import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * portal-client tests.
 *
 * Covers the P0-2 contract: a portal that holds the TCP socket open
 * without responding MUST be aborted by the agent within the 30s budget;
 * the call returns `{ retryable: true }` so the outbox re-queues with
 * backoff rather than dropping the event.
 */

vi.mock("./config.js", () => ({
  loadConfig: async () => ({
    clinicId: "11111111-2222-3333-4444-555555555555",
    portalBaseUrl: "https://portal.example",
    watchFolder: "/dev/null",
    machineFingerprint: "fp",
  }),
}));

vi.mock("./secure-store.js", () => ({
  loadSecret: async () => "a".repeat(64),
}));

let postEvent: typeof import("./portal-client").postEvent;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  const mod = await import("./portal-client.js");
  postEvent = mod.postEvent;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("postEvent — P0-2 fetch timeout", () => {
  it("aborts a hung portal request and returns retryable=true", async () => {
    // Stub fetch with a Promise that ONLY resolves on abort (simulating
    // a TCP-open / no-response portal). The real Node fetch rejects the
    // returned Promise with an AbortError when controller.abort() fires;
    // we mirror that behaviour so the production code path is exercised.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const err = new Error("aborted") as Error & { name: string };
            err.name = "AbortError";
            reject(err);
          });
        })
    );

    const pending = postEvent('{"kind":"PatientUpserted"}');

    // Advance virtual time past the 30s timeout. The AbortController's
    // setTimeout fires, fetch's mock rejects with AbortError, postEvent
    // catches it and returns a retryable timeout result.
    await vi.advanceTimersByTimeAsync(31_000);

    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
    expect(result.reason).toMatch(/timeout/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT abort a fast successful response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: true, status: "ingested" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        })
    );

    const pending = postEvent('{"kind":"PatientUpserted"}');
    // Don't advance timers — the response completes immediately, the
    // 30s setTimeout should be cleared in the finally block.
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.deduped).toBe(false);
  });

  it("clears the timeout on a 5xx so it can't fire after the call returns", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("oops", { status: 503 })
    );

    const result = await postEvent('{"kind":"PatientUpserted"}');
    expect(result).toEqual({
      ok: false,
      retryable: true,
      reason: "http 503",
    });
    // After the call returns, advancing timers shouldn't cause anything to
    // happen (no pending timeouts left). Vitest doesn't blow up; the
    // assertion below is here to document the intent — there should be 0
    // pending timers.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("non-retryable 4xx surfaces the body and clears the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: "bad_signature" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );

    const result = await postEvent('{"kind":"PatientUpserted"}');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect(result.reason).toContain("http 400");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("network-level error (DNS, refused) is retryable but NOT a timeout reason", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED 127.0.0.1:443"))
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
    expect(result.reason).toMatch(/network:/);
    expect(result.reason).not.toMatch(/timeout/);
  });
});

describe("postEvent — retryable vs permanent HTTP statuses (review finding 4)", () => {
  const cases: Array<{ status: number; retryable: boolean; why: string }> = [
    { status: 409, retryable: true, why: "link_not_ready, transient until operator confirms" },
    { status: 408, retryable: true, why: "request timeout" },
    { status: 425, retryable: true, why: "too early" },
    { status: 429, retryable: true, why: "rate limited" },
    { status: 503, retryable: true, why: "server error" },
    { status: 400, retryable: false, why: "invalid envelope, genuinely malformed" },
    { status: 404, retryable: false, why: "clinic not found, misconfiguration" },
  ];
  for (const { status, retryable, why } of cases) {
    it(`HTTP ${status} → retryable=${retryable} (${why})`, async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(
        async () =>
          new Response(JSON.stringify({ error: { code: "x" } }), { status })
      );
      const result = await postEvent('{"kind":"PatientUpserted"}');
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.retryable).toBe(retryable);
    });
  }
});
