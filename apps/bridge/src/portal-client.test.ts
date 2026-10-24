import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./db/client.js", () => ({
  loadClinicPvsSecret: vi.fn(async () => "a".repeat(64)),
}));
vi.mock("./config.js", () => ({
  env: () => ({ PORTAL_BASE_URL: "http://portal.test" }),
}));

import { loadClinicPvsSecret } from "./db/client.js";
import { postAll, POST_CHUNK, _resetPortalClientState } from "./portal-client.js";
import type { CanonicalEvent } from "./canonical/types.js";

const CLINIC = "11111111-1111-4111-8111-111111111111";

function ev(i: number): CanonicalEvent {
  return {
    kind: "PatientUpserted",
    clinicId: CLINIC,
    bridgeSource: "pabau",
    pvsExternalEventId: `e${i}`,
    occurredAt: "2026-10-01T10:00:00.000Z",
    pvsPatientId: `p${i}`,
  };
}
const evs = (n: number) => Array.from({ length: n }, (_, i) => ev(i));

const json = (body: unknown, status = 201, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const origFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  _resetPortalClientState();
  vi.mocked(loadClinicPvsSecret).mockClear();
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

/** Portal batch answer for n events from a per-index function. */
function batchAnswer(n: number, at: (i: number) => { status: string } | { error: string }) {
  const results = Array.from({ length: n }, (_, i) => at(i));
  const count = (s: string) => results.filter((r) => "status" in r && r.status === s).length;
  const errors = results
    .map((r, idx) => ("error" in r ? { idx, reason: r.error } : null))
    .filter(Boolean);
  return {
    ok: true,
    ingested: count("ingested"),
    deduped: count("deduped"),
    quarantined: count("quarantined"),
    errors,
    results,
  };
}

describe("postAll: per-event outcomes from `results`", () => {
  it("counts ingested / deduped / quarantined, skips permanent reasons, blocks on retryable ones", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      return json(
        batchAnswer(n, (i) =>
          i === 0 ? { status: "ingested" }
          : i === 1 ? { status: "deduped" }
          : i === 2 ? { status: "quarantined" }
          : i === 3 ? { error: "invalid_envelope" }
          : i === 4 ? { error: "billing_conflict" }
          : { error: "link_not_ready" }
        )
      );
    });
    const r = await postAll(CLINIC, evs(8));
    expect(r).toMatchObject({
      ingested: 1,
      deduped: 1,
      quarantined: 1,
      skipped: 2,
      errors: 3,
      skippedByReason: { invalid_envelope: 1, billing_conflict: 1 },
    });
    expect(r.failure).toBe("http 201: link_not_ready x3");
  });

  it("permanent-only rejections are skipped and do NOT block (errors = 0)", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      return json(batchAnswer(n, (i) => (i === 2 ? { error: "clinic_mismatch" } : { status: "ingested" })));
    });
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(0);
    expect(r.skipped).toBe(1);
    expect(r.ingested).toBe(5);
    expect(r.failure).toBeUndefined();
  });

  it("unknown / retryable reasons all block: vendor_mismatch, internal_error, rate_limited, mystery", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      const reasons = ["vendor_mismatch", "internal_error", "rate_limited", "mystery", "x"];
      return json(batchAnswer(n, (i) => ({ error: reasons[i % reasons.length]! })));
    });
    const r = await postAll(CLINIC, evs(5));
    expect(r.errors).toBe(5);
    expect(r.skipped).toBe(0);
  });

  it("falls back to errors[] when the portal sends no `results`", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        ok: true,
        ingested: 4,
        deduped: 0,
        quarantined: 0,
        errors: [
          { idx: 1, reason: "invalid_envelope" },
          { idx: 3, reason: "link_not_ready" },
        ],
      })
    );
    const r = await postAll(CLINIC, evs(6));
    expect(r).toMatchObject({ ingested: 4, skipped: 1, errors: 1 });
  });

  it("errors[] is capped at 50 by the portal: unlisted failures are treated as retryable, not as success", async () => {
    fetchMock.mockImplementation(async () =>
      json({
        ok: true,
        ingested: 100,
        deduped: 0,
        quarantined: 0,
        errors: Array.from({ length: 50 }, (_, i) => ({ idx: i, reason: "link_not_ready" })),
      })
    );
    const r = await postAll(CLINIC, evs(200));
    // 200 - 100 accepted - 50 listed = 50 failures nobody told us about.
    expect(r.errors).toBe(100);
    expect(r.ingested).toBe(100);
  });
});

describe("postAll: what counts as success (defect 8)", () => {
  it("HTTP 200 text/html (maintenance page) is NOT an ingest, single-event path", async () => {
    fetchMock.mockImplementation(
      async () => new Response("<html>Maintenance</html>", { status: 200, headers: { "content-type": "text/html" } })
    );
    const r = await postAll(CLINIC, evs(2));
    expect(r.ingested).toBe(0);
    expect(r.errors).toBe(2);
    expect(r.failure).toMatch(/unexpected_status_200/);
  });

  it("HTTP 200 text/html is NOT an ingest, batch path", async () => {
    fetchMock.mockImplementation(async () => new Response("<html>Maintenance</html>", { status: 200 }));
    const r = await postAll(CLINIC, evs(6));
    expect(r.ingested).toBe(0);
    expect(r.errors).toBe(6);
  });

  it("201 with ok:true but no counts/results is rejected as malformed", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true }));
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(r.failure).toMatch(/malformed_response/);
  });

  it("201 with ok:false is not an ingest", async () => {
    fetchMock.mockImplementation(async () => json({ ok: false, ingested: 6 }));
    expect((await postAll(CLINIC, evs(6))).errors).toBe(6);
  });

  it("never follows a redirect (redirect: 'error')", async () => {
    fetchMock.mockImplementation(async () => json({ ok: true, status: "ingested" }));
    await postAll(CLINIC, evs(2));
    await postAll(CLINIC, evs(6));
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).redirect).toBe("error");
    }
  });

  it("single-event 201 / 202 map to ingested / deduped / quarantined", async () => {
    const answers = [
      json({ ok: true, status: "ingested" }),
      json({ ok: true, status: "deduped" }),
      json({ ok: true, status: "quarantined" }, 202),
    ];
    fetchMock.mockImplementation(async () => answers.shift()!);
    const r = await postAll(CLINIC, evs(3));
    expect(r).toMatchObject({ ingested: 1, deduped: 1, quarantined: 1, errors: 0 });
  });
});

describe("postAll: whole-request failures", () => {
  it("429 + Retry-After blocks, reports the delay, and stops sending further chunks", async () => {
    fetchMock.mockImplementation(async () =>
      json({ error: { code: "rate_limited" } }, 429, { "retry-after": "42" })
    );
    const r = await postAll(CLINIC, evs(POST_CHUNK * 2 + 10));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.errors).toBe(POST_CHUNK * 2 + 10);
    expect(r.retryAfterMs).toBe(42_000);
    expect(r.failure).toMatch(/^http 429: rate_limited/);
  });

  it.each([408, 500, 502, 503, 409])("HTTP %i is retryable (blocks, never skipped)", async (status) => {
    fetchMock.mockImplementation(async () => json({ error: { code: "x" } }, status));
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(r.skipped).toBe(0);
    expect(r.failure).toContain(`http ${status}`);
  });

  it("network error / timeout blocks with the cause", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(r.failure).toMatch(/network: TypeError: fetch failed/);
  });

  it("a rotated secret (401 / 400 invalid_request) blocks and drops the secret cache", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "invalid_request" } }, 400));
    let r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(r.skipped).toBe(0);
    expect(r.failure).toMatch(/auth_rejected/);
    await postAll(CLINIC, evs(6));
    expect(loadClinicPvsSecret).toHaveBeenCalledTimes(2);
    fetchMock.mockImplementation(async () => json({}, 401));
    r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
  });

  it("a wrong PORTAL_BASE_URL (bare 404) blocks instead of skipping everything", async () => {
    fetchMock.mockImplementation(async () => new Response("not found", { status: 404 }));
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(r.skipped).toBe(0);
  });

  it("no secret for the clinic blocks", async () => {
    vi.mocked(loadClinicPvsSecret).mockResolvedValueOnce(null);
    const r = await postAll(CLINIC, evs(6));
    expect(r.errors).toBe(6);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("postAll: a poison event is isolated by bisection", () => {
  it("a batch rejected as a whole (400 invalid_envelope) is bisected; only the poison event is skipped", async () => {
    const POISON = "e13";
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      // Small halves go through the single-event endpoint.
      const events = (url.endsWith("/batch") ? body.events : [body]) as Array<{ pvsExternalEventId: string }>;
      if (events.some((e) => e.pvsExternalEventId === POISON)) {
        return json({ error: { code: "invalid_envelope" } }, 400);
      }
      return url.endsWith("/batch")
        ? json(batchAnswer(events.length, () => ({ status: "ingested" })))
        : json({ ok: true, status: "ingested" });
    });
    const r = await postAll(CLINIC, evs(20));
    expect(r.skipped).toBe(1);
    expect(r.ingested).toBe(19);
    expect(r.errors).toBe(0);
  });

  it("gives up bisecting after the request budget and BLOCKS rather than skipping a chunk on a guess", async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: "invalid_envelope" } }, 400));
    const r = await postAll(CLINIC, evs(POST_CHUNK));
    // Every request is rejected: bisection bottoms out in single-event skips
    // until the budget is spent; whatever it could not isolate is retryable.
    expect(r.skipped + r.errors).toBe(POST_CHUNK);
    expect(r.errors).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.length).toBeLessThan(45);
  });
});

describe("postAll: sanitising and pacing", () => {
  it("events the sanitiser drops are never sent and are counted by reason", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      return json(batchAnswer(n, () => ({ status: "ingested" })));
    });
    const bad = { ...ev(99), pvsPatientId: "" } as CanonicalEvent;
    const r = await postAll(CLINIC, [...evs(5), bad]);
    expect(r.dropped).toBe(1);
    expect(r.droppedByReason).toEqual({ "PatientUpserted:pvsPatientId": 1 });
    expect(r.ingested).toBe(5);
    const sent = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).events;
    expect(sent).toHaveLength(5);
  });

  it("paces consecutive batches for one clinic by paceMs", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      return json(batchAnswer(n, () => ({ status: "ingested" })));
    });
    const t0 = Date.now();
    await postAll(CLINIC, evs(POST_CHUNK + 10), { paceMs: 120 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(110);
  });

  it("chunks at POST_CHUNK (200), under the portal cap of 500", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const n = (JSON.parse(String(init.body)).events as unknown[]).length;
      return json(batchAnswer(n, () => ({ status: "ingested" })));
    });
    const r = await postAll(CLINIC, evs(450));
    expect(POST_CHUNK).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(r.ingested).toBe(450);
  });

  it("an aborted signal rejects instead of reporting a portal failure", async () => {
    const ac = new AbortController();
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      ac.abort(new Error("deadline"));
      throw (init.signal as AbortSignal).reason ?? new Error("aborted");
    });
    await expect(postAll(CLINIC, evs(6), { signal: ac.signal })).rejects.toBeDefined();
  });
});
