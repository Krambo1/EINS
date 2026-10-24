import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WP-C portal-client hardening:
 *   A3  a non-auth 4xx is permanent only for a JSON body with a known portal
 *       error code; an HTML page from a proxy / CDN / captive portal is not.
 *   A10 the single-event path needs a JSON ok:true body with a known status.
 *   B2  every agent POST passes redirect:"error" (fetch would turn a 301/302
 *       POST into a GET).
 *   B4  a batch timeout and an ambiguous 2xx are flagged for the flush loop.
 */

const { loadConfigMock } = vi.hoisted(() => ({ loadConfigMock: vi.fn() }));
vi.mock("./config.js", () => ({ loadConfig: loadConfigMock }));
vi.mock("./secure-store.js", () => ({ loadSecret: async () => "a".repeat(64) }));

const CLINIC = "11111111-2222-3333-4444-555555555555";
let mod: typeof import("./portal-client");

beforeEach(async () => {
  vi.resetModules();
  loadConfigMock.mockReset().mockResolvedValue({
    clinicId: CLINIC,
    portalBaseUrl: "https://portal.example",
    watchFolder: "/dev/null",
    machineFingerprint: "fp",
  });
  mod = await import("./portal-client.js");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function reply(status: number, body: string, contentType = "text/html") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      async () => new Response(body, { status, headers: { "content-type": contentType } })
    );
}
const json = (o: unknown) => JSON.stringify(o);

describe("A3: permanent only for a JSON body with a known portal error code", () => {
  const HTML = "<html><body>Not Found - DEPLOYMENT_NOT_FOUND</body></html>";

  for (const status of [400, 404, 406, 410, 413, 414, 431]) {
    it(`HTTP ${status} with an HTML body is retryable and flagged unrecognized`, async () => {
      reply(status, HTML);
      const r = await mod.postEvent('{"kind":"PatientUpserted"}');
      if (r.ok) throw new Error("unreachable");
      expect(r.retryable).toBe(true);
      expect(r.authFailure).toBeFalsy();
      expect(r.httpStatus).toBe(status);
      expect(r.unrecognizedResponse).toBe(true);
    });
  }

  it("a JSON body with an unknown error code is retryable", async () => {
    reply(404, json({ error: { code: "x" } }), "application/json");
    const r = await mod.postEvent("{}");
    if (r.ok) throw new Error("unreachable");
    expect(r.retryable).toBe(true);
  });

  it("a known code stays permanent and carries the status", async () => {
    reply(404, json({ error: { code: "clinic_not_found" } }), "application/json");
    const r = await mod.postEvent("{}");
    if (r.ok) throw new Error("unreachable");
    expect(r.retryable).toBe(false);
    expect(r.httpStatus).toBe(404);
    reply(400, json({ error: { code: "invalid_envelope" } }), "application/json");
    const r2 = await mod.postEvent("{}");
    if (r2.ok) throw new Error("unreachable");
    expect(r2.retryable).toBe(false);
  });

  it("a plain 400 invalid_request is still auth-class", async () => {
    reply(400, json({ error: { code: "invalid_request" } }), "application/json");
    const r = await mod.postEvent("{}");
    if (r.ok) throw new Error("unreachable");
    expect(r.authFailure).toBe(true);
  });

  it("a 5xx stays retryable and now carries httpStatus", async () => {
    reply(502, HTML);
    const r = await mod.postEvent("{}");
    if (r.ok) throw new Error("unreachable");
    expect(r).toMatchObject({ retryable: true, httpStatus: 502 });
  });
});

describe("A10: the single-event path needs ok:true and a known status", () => {
  for (const [name, body, type] of [
    ["an HTML 200", "<html>login</html>", "text/html"],
    ["an empty JSON object", "{}", "application/json"],
    ["a JSON array", "[]", "application/json"],
    ["ok:true without a status", json({ ok: true }), "application/json"],
    ["an unknown status", json({ ok: true, status: "weird" }), "application/json"],
    ["ok:false", json({ ok: false, status: "ingested" }), "application/json"],
  ] as const) {
    it(`${name} is NOT treated as stored`, async () => {
      reply(200, body, type);
      const r = await mod.postEvent("{}");
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error("unreachable");
      expect(r.retryable).toBe(true);
    });
  }

  it("accepts ingested, deduped and quarantined", async () => {
    for (const status of ["ingested", "deduped", "quarantined"]) {
      reply(201, json({ ok: true, status }), "application/json");
      const r = await mod.postEvent("{}");
      expect(r).toMatchObject({ ok: true, deduped: status === "deduped" });
    }
  });
});

describe("B2: redirect:error on every agent POST", () => {
  it("postEvent, postEventBatch and postHeartbeat refuse to follow redirects", async () => {
    const spy = reply(201, json({ ok: true, status: "ingested" }), "application/json");
    await mod.postEvent("{}");
    await mod.postEventBatch(CLINIC, ["{}"]);
    await mod.postHeartbeat({
      clinicId: CLINIC,
      agentVersion: "t",
      failedCount: 0,
      oldestFailedAt: null,
      lastFailureReason: null,
      recentReasons: [],
      enrolledVendors: [],
      sentAt: 1,
    });
    expect(spy).toHaveBeenCalledTimes(3);
    for (const call of spy.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe("error");
    }
  });

  it("a redirect error is a retryable network failure with a readable reason", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("unexpected redirect"),
      })
    );
    const r = await mod.postEvent("{}");
    if (r.ok) throw new Error("unreachable");
    expect(r.retryable).toBe(true);
    expect(r.reason).toMatch(/redirect/i);
  });
});

describe("B4: batch failures are classified for the flush loop", () => {
  it("our own timeout is flagged timedOut", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_u, init) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener("abort", () =>
            rej(Object.assign(new Error("aborted"), { name: "AbortError" }))
          );
        })
    );
    const p = mod.postEventBatch(CLINIC, ["{}"]);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(await p).toMatchObject({ ok: false, networkFailure: true, timedOut: true });
  });

  it("a connection refusal is NOT flagged timedOut", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await mod.postEventBatch(CLINIC, ["{}"]);
    expect(r).toMatchObject({ ok: false, networkFailure: true });
    expect((r as { timedOut?: boolean }).timedOut).toBeFalsy();
  });

  it("an ambiguous 2xx is flagged ambiguous", async () => {
    reply(201, json({ ok: true }), "application/json");
    expect(await mod.postEventBatch(CLINIC, ["{}"])).toMatchObject({
      ok: false,
      retryable: true,
      ambiguous: true,
    });
  });

  it("a batch-level 404 HTML still falls back to single (old portal) and says so", async () => {
    reply(404, "<html>nf</html>");
    expect(await mod.postEventBatch(CLINIC, ["{}"])).toMatchObject({
      ok: false,
      fallbackToSingle: true,
      httpStatus: 404,
    });
  });
});
