import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * portal-client tests.
 *
 * Covers the P0-2 contract: a portal that holds the TCP socket open
 * without responding MUST be aborted by the agent within the 30s budget;
 * the call returns `{ retryable: true }` so the outbox re-queues with
 * backoff rather than dropping the event.
 */

// L21: loadConfig is a spy so we can assert the runtime POST path reads the
// config from disk at most once (it is cached for the process lifetime).
const { loadConfigMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
}));

const SAMPLE_CONFIG = {
  clinicId: "11111111-2222-3333-4444-555555555555",
  portalBaseUrl: "https://portal.example",
  watchFolder: "/dev/null",
  machineFingerprint: "fp",
};

vi.mock("./config.js", () => ({
  loadConfig: loadConfigMock,
}));

vi.mock("./secure-store.js", () => ({
  loadSecret: async () => "a".repeat(64),
}));

let postEvent: typeof import("./portal-client").postEvent;
let isAuthClassRejection: typeof import("./portal-client").isAuthClassRejection;
let parseRetryAfterMs: typeof import("./portal-client").parseRetryAfterMs;
let RETRY_AFTER_MAX_MS: typeof import("./portal-client").RETRY_AFTER_MAX_MS;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  loadConfigMock.mockReset();
  loadConfigMock.mockResolvedValue({ ...SAMPLE_CONFIG });
  const mod = await import("./portal-client.js");
  postEvent = mod.postEvent;
  isAuthClassRejection = mod.isAuthClassRejection;
  parseRetryAfterMs = mod.parseRetryAfterMs;
  RETRY_AFTER_MAX_MS = mod.RETRY_AFTER_MAX_MS;
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

  it("non-retryable validation 4xx surfaces the body and clears the timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_envelope" } }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
    );

    const result = await postEvent('{"kind":"PatientUpserted"}');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    // A validation reject is NOT auth-class → stays permanent.
    expect(result.authFailure).toBeFalsy();
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

describe("isAuthClassRejection (H11)", () => {
  it("classifies 401 / 403 as auth-class", () => {
    expect(isAuthClassRejection(401, "")).toBe(true);
    expect(isAuthClassRejection(403, "anything")).toBe(true);
  });

  it("classifies 400 invalid_request (portal's symmetric bad-signature) as auth-class", () => {
    expect(
      isAuthClassRejection(400, JSON.stringify({ error: { code: "invalid_request" } }))
    ).toBe(true);
  });

  it("does NOT classify validation 400s as auth-class", () => {
    expect(
      isAuthClassRejection(400, JSON.stringify({ error: { code: "invalid_envelope" } }))
    ).toBe(false);
    expect(
      isAuthClassRejection(400, JSON.stringify({ error: { code: "invalid_bridge_source" } }))
    ).toBe(false);
  });

  it("does NOT classify 404 / 429 / 500 as auth-class", () => {
    expect(isAuthClassRejection(404, '{"error":{"code":"clinic_not_found"}}')).toBe(false);
    expect(isAuthClassRejection(429, "")).toBe(false);
    expect(isAuthClassRejection(500, "")).toBe(false);
  });
});

describe("postEvent - auth-class rejection sets authFailure (H11)", () => {
  it("a 400 invalid_request is non-retryable AND flagged authFailure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ error: { code: "invalid_request" } }), {
          status: 400,
        })
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(false);
    expect(result.authFailure).toBe(true);
    expect(result.reason).toMatch(/auth rejected/);
  });

  it("a 403 is flagged authFailure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("forbidden", { status: 403 })
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    if (result.ok) throw new Error("unreachable");
    expect(result.authFailure).toBe(true);
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

describe("postEvent - L21 config is cached for the process lifetime", () => {
  it("reads config from disk only once across multiple POSTs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: "ingested" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    await postEvent('{"kind":"A"}');
    await postEvent('{"kind":"B"}');
    await postEvent('{"kind":"C"}');
    // Without the cache this would be 3 disk reads + JSON parses.
    expect(loadConfigMock).toHaveBeenCalledTimes(1);
  });

  it("keeps last-known-good config if config.json later goes corrupt (no silent no_config flip)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(JSON.stringify({ status: "ingested" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const first = await postEvent('{"kind":"A"}');
    expect(first.ok).toBe(true);

    // The on-disk config now goes corrupt: loadConfig would throw. Because the
    // good config is cached and never re-read, the agent keeps signing rather
    // than flipping into the unlogged no_config retry loop the finding calls out.
    loadConfigMock.mockRejectedValue(new Error("config is not valid JSON"));
    const second = await postEvent('{"kind":"B"}');
    expect(second.ok).toBe(true);
    expect(loadConfigMock).toHaveBeenCalledTimes(1);
  });
});

describe("postEvent - M-A3 network-class failures are flagged", () => {
  it("flags a timeout abort with networkFailure so the flush loop can fast-abort", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
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
    await vi.advanceTimersByTimeAsync(31_000);
    const result = await pending;
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
    expect(result.networkFailure).toBe(true);
  });

  it("flags a transport error (DNS / refused) with networkFailure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.reject(new Error("ECONNREFUSED 127.0.0.1:443"))
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    if (result.ok) throw new Error("unreachable");
    expect(result.networkFailure).toBe(true);
  });

  it("does NOT flag a retryable HTTP status (portal reachable) as networkFailure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("busy", { status: 503 })
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    if (result.ok) throw new Error("unreachable");
    expect(result.networkFailure).toBeFalsy();
  });
});

describe("postEvent - M-A3 captures a Retry-After header", () => {
  it("parses a numeric Retry-After on a 429 into retryAfterMs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response("slow down", {
          status: 429,
          headers: { "retry-after": "120" },
        })
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    if (result.ok) throw new Error("unreachable");
    expect(result.retryable).toBe(true);
    expect(result.retryAfterMs).toBe(120_000);
  });

  it("omits retryAfterMs when the retryable response has no Retry-After header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("oops", { status: 503 })
    );
    const result = await postEvent('{"kind":"PatientUpserted"}');
    if (result.ok) throw new Error("unreachable");
    expect(result.retryAfterMs).toBeUndefined();
  });
});

describe("parseRetryAfterMs (M-A3)", () => {
  const NOW = 1_000_000_000_000;

  it("returns null for missing / empty values", () => {
    expect(parseRetryAfterMs(null, NOW)).toBeNull();
    expect(parseRetryAfterMs(undefined, NOW)).toBeNull();
    expect(parseRetryAfterMs("", NOW)).toBeNull();
    expect(parseRetryAfterMs("   ", NOW)).toBeNull();
  });

  it("parses delta-seconds into milliseconds", () => {
    expect(parseRetryAfterMs("0", NOW)).toBe(0);
    expect(parseRetryAfterMs("1", NOW)).toBe(1_000);
    expect(parseRetryAfterMs("30", NOW)).toBe(30_000);
    expect(parseRetryAfterMs("  45  ", NOW)).toBe(45_000);
  });

  it("parses an HTTP-date into a delay relative to now", () => {
    const future = new Date(NOW + 90_000).toUTCString();
    expect(parseRetryAfterMs(future, NOW)).toBe(90_000);
  });

  it("floors a past HTTP-date at 0", () => {
    const past = new Date(NOW - 60_000).toUTCString();
    expect(parseRetryAfterMs(past, NOW)).toBe(0);
  });

  it("clamps to RETRY_AFTER_MAX_MS", () => {
    // delta-seconds well past the cap.
    expect(parseRetryAfterMs("100000", NOW)).toBe(RETRY_AFTER_MAX_MS);
    // an HTTP-date hours in the future.
    const farFuture = new Date(NOW + 3 * 60 * 60_000).toUTCString();
    expect(parseRetryAfterMs(farFuture, NOW)).toBe(RETRY_AFTER_MAX_MS);
  });

  it("returns null for garbage / unparseable values", () => {
    expect(parseRetryAfterMs("soon", NOW)).toBeNull();
    expect(parseRetryAfterMs("12x", NOW)).toBeNull();
    expect(parseRetryAfterMs("not-a-date", NOW)).toBeNull();
    expect(parseRetryAfterMs("abc123", NOW)).toBeNull();
  });
});
