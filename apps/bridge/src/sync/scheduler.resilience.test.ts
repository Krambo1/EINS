import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../db/client.js", () => ({
  loadDueLinks: vi.fn(),
  claimLink: vi.fn(),
  checkpointSync: vi.fn(),
  saveProgress: vi.fn(),
  releaseLink: vi.fn(),
  recordFailure: vi.fn(),
  restoreLegacyErrorStatus: vi.fn(),
  markInitialSyncStarted: vi.fn(),
  completeInitialSync: vi.fn(),
  loadClinicPvsSecret: vi.fn(async () => "a".repeat(64)),
}));
vi.mock("../config.js", () => ({
  env: () => ({
    SCHEDULER_TICK_MS: 20,
    SCHEDULER_CONCURRENCY: 2,
    FAIL_THRESHOLD: 10,
    PORTAL_BASE_URL: "http://portal.test",
  }),
}));

import {
  loadDueLinks,
  claimLink,
  checkpointSync,
  saveProgress,
  releaseLink,
  recordFailure,
  restoreLegacyErrorStatus,
  markInitialSyncStarted,
  completeInitialSync,
  type PvsLinkRow,
} from "../db/client.js";
import { _internal, startScheduler } from "./scheduler.js";
import { pabauAdapter } from "../adapters/pabau/index.js";
import { _resetPortalClientState } from "../portal-client.js";
import { getSchedulerState, _resetHealth } from "../health.js";
import type { Adapter } from "../adapters/Adapter.js";

/**
 * End-to-end resilience of the scheduler with the REAL portal client, sanitiser,
 * stream engine and Pabau adapter against a fake portal + fake vendor. These are
 * the reviewer's throwaway proofs (poison / zombie / ack / cursor) turned into
 * regressions with the opposite assertions.
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-01T10:00:00.000Z";

function link(over: Partial<PvsLinkRow> = {}): PvsLinkRow {
  return {
    id: "L",
    clinicId: CLINIC,
    pvsVendor: "pabau",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: { pabauApiToken: "t" },
    lastCursor: null,
    initialSyncCompletedAt: "2026-09-01T00:00:00.000Z",
    ...over,
  };
}

interface Vendor {
  patients: Array<Record<string, unknown>>;
  perPage?: number;
}

type PortalHandler = (events: Array<Record<string, unknown>>) => Array<{ status: string } | { error: string }>;

const calls = { portal: 0, vendor: 0, portalBodies: [] as unknown[] };

function installFetch(vendor: Vendor, portal: PortalHandler, opts: { portalStatus?: number; retryAfter?: string } = {}) {
  calls.portal = 0;
  calls.vendor = 0;
  calls.portalBodies = [];
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.host === "portal.test") {
      calls.portal += 1;
      const body = JSON.parse(String(init!.body));
      calls.portalBodies.push(body);
      if (opts.portalStatus && opts.portalStatus !== 201) {
        return new Response(JSON.stringify({ error: { code: "rate_limited" } }), {
          status: opts.portalStatus,
          headers: opts.retryAfter ? { "retry-after": opts.retryAfter } : {},
        });
      }
      const events = u.pathname.endsWith("/batch") ? body.events : [body];
      const results = portal(events);
      if (!u.pathname.endsWith("/batch")) {
        const r = results[0]!;
        return "error" in r
          ? new Response(JSON.stringify({ error: { code: r.error } }), { status: r.error === "link_not_ready" ? 409 : 400 })
          : new Response(JSON.stringify({ ok: true, status: r.status }), { status: 201 });
      }
      const count = (s: string) => results.filter((r) => "status" in r && r.status === s).length;
      return new Response(
        JSON.stringify({
          ok: true,
          ingested: count("ingested"),
          deduped: count("deduped"),
          quarantined: count("quarantined"),
          errors: results.map((r, idx) => ("error" in r ? { idx, reason: r.error } : null)).filter(Boolean),
          results,
        }),
        { status: 201 }
      );
    }
    // fake Pabau
    calls.vendor += 1;
    if (!u.pathname.endsWith("/patients")) return new Response(JSON.stringify({ data: [] }), { status: 200 });
    const per = vendor.perPage ?? Number(u.searchParams.get("per_page"));
    const page = Number(u.searchParams.get("page"));
    return new Response(JSON.stringify({ data: vendor.patients.slice((page - 1) * per, page * per) }), { status: 200 });
  }) as unknown as typeof fetch;
}

const okPortal: PortalHandler = (events) => events.map(() => ({ status: "ingested" }));
const origFetch = globalThis.fetch;

beforeEach(() => {
  _resetPortalClientState();
  for (const m of [
    checkpointSync,
    saveProgress,
    releaseLink,
    recordFailure,
    restoreLegacyErrorStatus,
    markInitialSyncStarted,
    completeInitialSync,
  ]) {
    vi.mocked(m as (...a: never[]) => Promise<unknown>).mockReset().mockResolvedValue(undefined);
  }
  vi.mocked(claimLink).mockReset().mockResolvedValue(true);
  vi.mocked(loadDueLinks).mockReset().mockResolvedValue([]);
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("defect 2: one permanently rejected event no longer freezes the practice", () => {
  const rows = [
    { id: 1, email: "ok@example.de", modified_at: "2026-10-01T10:00:00.000Z" },
    { id: 2, email: "", dob: "1980-05-12T00:00:00Z", notes: "x".repeat(9000), modified_at: "2026-10-01T10:01:00.000Z" },
    { id: 3, email: "n/a", modified_at: "2026-10-01T10:02:00.000Z" },
    { id: 4, email: "poison@example.de", modified_at: "2026-10-01T10:03:00.000Z" },
    { id: 5, email: "after@example.de", modified_at: "2026-10-01T10:04:00.000Z" },
  ];

  it("repairable vendor values are repaired, the portal-rejected one is skipped, the cursor advances", async () => {
    installFetch({ patients: rows }, (events) =>
      events.map((e) => (e.pvsPatientId === "4" ? { error: "invalid_envelope" } : { status: "ingested" }))
    );
    await _internal.runPoll(link(), pabauAdapter);

    expect(recordFailure).not.toHaveBeenCalled();
    // The repaired events went out valid: no empty email, date-only dob, no free-text notes.
    const sent = (calls.portalBodies.flatMap((b) => (b as { events?: unknown[] }).events ?? [b]) as Array<Record<string, unknown>>).filter(
      (e) => e.kind === "PatientUpserted"
    );
    expect(sent).toHaveLength(5);
    const p2 = sent.find((e) => e.pvsPatientId === "2")!;
    expect(p2).not.toHaveProperty("email");
    expect(p2.dob).toBe("1980-05-12");
    expect(p2).not.toHaveProperty("bemerkung"); // free-text notes never leave the bridge (only the EINS-Lead token does)
    expect(sent.find((e) => e.pvsPatientId === "3")).not.toHaveProperty("email");

    // The patients cursor moved PAST the poison row (to the newest row seen).
    const saved = vi.mocked(saveProgress).mock.calls.map((c) => c[1].cursor!).filter(Boolean);
    // (streams run revenue first, so the patients cursor is the last one saved)
    expect(saved.at(-1)!.split(",")[0]).toBe("2026-10-01T10:04:00.000Z");
    expect(checkpointSync).toHaveBeenCalledTimes(1);
    const cp = vi.mocked(checkpointSync).mock.calls[0]![1];
    expect(cp.warning).toMatch(/1 event\(s\) permanently rejected by the portal and skipped \(invalid_envelope x1\)/);
    expect(cp.warning).not.toMatch(/example\.de/); // no patient data in last_error
  });

  it("three consecutive polls make progress (the old behaviour re-fetched the same poison forever)", async () => {
    installFetch({ patients: rows }, (events) =>
      events.map((e) => (e.pvsPatientId === "4" ? { error: "invalid_envelope" } : { status: "ingested" }))
    );
    let cursor: string | null = null;
    const seen: Array<string | null> = [];
    for (let i = 0; i < 3; i++) {
      _resetPortalClientState(); // (batch pacing is exercised in portal-client.test.ts)
      vi.mocked(saveProgress).mockClear();
      await _internal.runPoll(link({ lastCursor: cursor }), pabauAdapter);
      seen.push(cursor);
      cursor = vi.mocked(checkpointSync).mock.calls.at(-1)![1].cursor;
    }
    expect(vi.mocked(recordFailure)).not.toHaveBeenCalled();
    expect(seen[0]).toBeNull();
    expect(seen[1]).not.toBeNull();
  });

  it("an event the sanitiser drops (missing required id) is counted and does not block either", async () => {
    installFetch({ patients: [{ id: "", email: "a@b.de", modified_at: T0 }, rows[0]!] }, okPortal);
    await _internal.runPoll(link(), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(vi.mocked(checkpointSync).mock.calls[0]![1].warning).toMatch(/1 invalid event\(s\) dropped before sending \(PatientUpserted:pvsPatientId x1\)/);
  });
});

describe("defect 1: a failing link is never tripped to 'error' and recovers by itself", () => {
  it("link_not_ready blocks the checkpoint, is recorded with status + reason, and the SAME cursor is retried", async () => {
    installFetch({ patients: [{ id: 1, email: "a@b.de", modified_at: T0 }] }, (events) =>
      events.map(() => ({ error: "link_not_ready" }))
    );
    await _internal.runPoll(link({ lastCursor: "C0" }), pabauAdapter);
    expect(checkpointSync).not.toHaveBeenCalled();
    // The empty revenue stream (walked first) may persist its own watermark; the
    // blocked patients stream must not have moved.
    for (const c of vi.mocked(saveProgress).mock.calls.map((x) => x[1].cursor!)) {
      expect(c.split(",")[0]).toBe("1970-01-01T00:00:00.000Z");
    }
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/1 event\(s\) failed to post to portal \(http 409: link_not_ready x1\); cursor not advanced/);

    // The portal accepts again (link back to connected): next poll succeeds from the same cursor.
    installFetch({ patients: [{ id: 1, email: "a@b.de", modified_at: T0 }] }, okPortal);
    await _internal.runPoll(link({ lastCursor: "C0" }), pabauAdapter);
    expect(checkpointSync).toHaveBeenCalledTimes(1);
  });

  it("the db module exposes no way to write pvs_link.status='error'", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../db/client.ts", import.meta.url), "utf8")
    );
    expect(src).not.toMatch(/SET\s+status\s*=\s*'error'/);
  });

  it("a portal 429 is recorded WITH its Retry-After so the retry waits at least that long", async () => {
    installFetch({ patients: [{ id: 1, email: "a@b.de", modified_at: T0 }] }, okPortal, {
      portalStatus: 429,
      retryAfter: "600",
    });
    // Use the buffered 1-event path (<5 events: single endpoint) and 0 retries to keep the test fast.
    await _internal.runPoll(link(), pabauAdapter);
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/http 429: rate_limited/);
    expect(vi.mocked(recordFailure).mock.calls[0]![3]).toBe(600_000);
  }, 20_000);

  it("recordFailure throwing does not escape runPoll (one link cannot abort the tick)", async () => {
    installFetch({ patients: [{ id: 1, email: "a@b.de", modified_at: T0 }] }, (e) => e.map(() => ({ error: "link_not_ready" })));
    vi.mocked(recordFailure).mockRejectedValue(new Error("db down"));
    await expect(_internal.runPoll(link(), pabauAdapter)).resolves.toBeUndefined();
  });
});

describe("defect 4: deadline cancels the work; unbounded paging is cut", () => {
  it("a vendor that ignores paging fails the poll fast instead of paging forever", async () => {
    const samePage = Array.from({ length: 100 }, (_, i) => ({ id: i, email: "a@b.de", modified_at: T0 }));
    let vendorCalls = 0;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      if (new URL(String(url)).host === "portal.test") {
        const body = JSON.parse(String(init!.body));
        const n = (body.events ?? [body]).length;
        return new Response(
          JSON.stringify({ ok: true, ingested: n, deduped: 0, quarantined: 0, errors: [], results: Array(n).fill({ status: "ingested" }) }),
          { status: 201 }
        );
      }
      vendorCalls += 1;
      return new Response(JSON.stringify({ data: samePage }), { status: 200 });
    }) as unknown as typeof fetch;
    await _internal.runPoll(link(), pabauAdapter, { deadlineMs: 5_000 });
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/ignores paging/);
    const afterRun = vendorCalls;
    await new Promise((r) => setTimeout(r, 50));
    expect(vendorCalls).toBe(afterRun);
  });

  it("the deadline ABORTS in-flight vendor requests: no zombie keeps paging after runPoll returns", async () => {
    let vendorCalls = 0;
    let aborted = 0;
    globalThis.fetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => {
          vendorCalls += 1;
          init!.signal!.addEventListener("abort", () => {
            aborted += 1;
            rej(init!.signal!.reason);
          });
        })
    ) as unknown as typeof fetch;
    await _internal.runPoll(link(), pabauAdapter, { deadlineMs: 80 });
    expect(recordFailure).toHaveBeenCalledWith("L", expect.stringContaining("wall-clock budget"), 10);
    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toBe(1);
    expect(vendorCalls).toBe(1);
    expect(checkpointSync).not.toHaveBeenCalled();
  });

  it("a shutdown abort is not recorded as a link failure", async () => {
    globalThis.fetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)))
    ) as unknown as typeof fetch;
    const ac = new AbortController();
    const run = _internal.runPoll(link(), pabauAdapter, { signal: ac.signal, deadlineMs: 5_000 });
    await new Promise((r) => setTimeout(r, 20));
    ac.abort(new Error("scheduler stopped"));
    await run;
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("streams: each stream's cursor is saved as soon as that stream is accepted, so a later failure keeps it", async () => {
    // patients accepted, appointments blocked by the portal.
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host === "portal.test") {
        const body = JSON.parse(String(init!.body));
        const ev = body.events ? body.events[0] : body;
        if (ev.kind === "AppointmentCreated") {
          return new Response(JSON.stringify({ error: { code: "internal_error" } }), { status: 500 });
        }
        return new Response(JSON.stringify({ ok: true, status: "ingested" }), { status: 201 });
      }
      if (u.pathname.endsWith("/patients")) {
        const page = Number(u.searchParams.get("page"));
        return new Response(JSON.stringify({ data: page === 1 ? [{ id: 1, email: "a@b.de", modified_at: T0 }] : [] }), { status: 200 });
      }
      if (u.pathname.endsWith("/bookings")) {
        const page = Number(u.searchParams.get("page"));
        return new Response(
          JSON.stringify({ data: page === 1 ? [{ id: 9, client_id: 1, start_time: "2026-11-01T10:00:00Z", modified_at: T0 }] : [] }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await _internal.runPoll(link(), pabauAdapter);
    // Revenue (empty) is walked first and persisted, then patients; the blocked
    // appointments stream persists nothing.
    expect(saveProgress).toHaveBeenCalledTimes(2);
    const lastSaved = vi.mocked(saveProgress).mock.calls.at(-1)![1].cursor!.split(",");
    expect(lastSaved[0]).toBe(T0); // patients
    expect(lastSaved[1]).toBe("1970-01-01T00:00:00.000Z"); // appointments held
    expect(checkpointSync).not.toHaveBeenCalled();
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/http 500/);
  });
});

describe("defect 3: initial sync resumes instead of restarting", () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, email: `p${i}@b.de`, modified_at: `2026-09-01T10:0${i}:00.000Z` }));

  it("a run that uses up its budget saves progress and releases the link (no failure); the next run resumes and completes with the FIRST run's watermark", async () => {
    installFetch({ patients: rows, perPage: 2 }, okPortal);
    const fresh = link({ initialSyncCompletedAt: null });
    await _internal.runInitialLoad(fresh, pabauAdapter, { runBudgetMs: -1 });
    expect(markInitialSyncStarted).toHaveBeenCalledTimes(1);
    expect(completeInitialSync).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(releaseLink).toHaveBeenCalledTimes(1);
    expect(saveProgress).toHaveBeenCalledTimes(1);
    const token = vi.mocked(saveProgress).mock.calls[0]![1].cursor!;
    const t1 = JSON.parse(token);
    expect(t1).toMatchObject({ v: 1, i: 0, p: 2 });
    const postedFirstRun = calls.portal;

    // "Restart": a new run gets the persisted token via the link row.
    vi.mocked(markInitialSyncStarted).mockClear();
    vi.mocked(saveProgress).mockClear();
    installFetch({ patients: rows, perPage: 2 }, okPortal);
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null, lastCursor: token }), pabauAdapter);
    expect(markInitialSyncStarted).not.toHaveBeenCalled(); // not a fresh start
    expect(completeInitialSync).toHaveBeenCalledTimes(1);
    const done = vi.mocked(completeInitialSync).mock.calls[0]![1];
    expect(done.cursor).toBe(Array(5).fill(t1.start).join(","));
    // Page 1 (ids 1,2) was NOT posted again: resumed runs only send ids 3..6.
    const resent = calls.portalBodies.flatMap((b) => (b as { events?: Array<{ pvsPatientId?: string }> }).events ?? [b as { pvsPatientId?: string }]);
    expect(resent.map((e) => e.pvsPatientId)).toEqual(["3", "4", "5", "6"]);
    expect(postedFirstRun).toBeGreaterThan(0);
  });

  it("a blocked chunk fails the run WITHOUT losing earlier progress and without advancing the token past it", async () => {
    installFetch({ patients: rows, perPage: 2 }, (events) =>
      events.map((e) => (e.pvsPatientId === "3" ? { error: "link_not_ready" } : { status: "ingested" }))
    );
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), pabauAdapter);
    expect(completeInitialSync).not.toHaveBeenCalled();
    expect(saveProgress).toHaveBeenCalledTimes(1); // page 1 only
    expect(JSON.parse(vi.mocked(saveProgress).mock.calls[0]![1].cursor!)).toMatchObject({ i: 0, p: 2 });
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/link_not_ready/);
  });

  it("permanently rejected history events are skipped and summarised, the sync still completes", async () => {
    installFetch({ patients: rows, perPage: 3 }, (events) =>
      events.map((e) => (e.pvsPatientId === "2" ? { error: "billing_conflict" } : { status: "ingested" }))
    );
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), pabauAdapter);
    expect(completeInitialSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(completeInitialSync).mock.calls[0]![1].warning).toMatch(/billing_conflict x1/);
  });

  it("a portal 429 mid-sync is slept through (Retry-After) and the chunk is re-sent", async () => {
    let first = true;
    globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.host === "portal.test") {
        if (first) {
          first = false;
          return new Response(JSON.stringify({ error: { code: "rate_limited" } }), { status: 429, headers: { "retry-after": "1" } });
        }
        const body = JSON.parse(String(init!.body));
        const events = body.events ?? [body];
        return new Response(JSON.stringify({ ok: true, status: "ingested" }), { status: 201 });
        void events;
      }
      const page = Number(u.searchParams.get("page"));
      return new Response(
        JSON.stringify({ data: u.pathname.endsWith("/patients") && page === 1 ? [rows[0]] : [] }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    await _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), pabauAdapter);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(900);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(completeInitialSync).toHaveBeenCalledTimes(1);
  }, 20_000);
});

describe("defect 7: schedulers claim links before working them", () => {
  function fakeAdapter(poll: Adapter["poll"]): Adapter {
    return {
      vendor: "tomedo",
      async connect() {
        return { ok: true as const };
      },
      async *initialSync() {},
      poll,
    };
  }
  const original = _internal.ADAPTERS.tomedo;
  afterEach(() => {
    _internal.ADAPTERS.tomedo = original;
  });

  it("a link whose claim is lost to another machine is NOT polled", async () => {
    const poll = vi.fn(async () => ({ events: [], nextCursor: null }));
    _internal.ADAPTERS.tomedo = fakeAdapter(poll);
    vi.mocked(claimLink).mockResolvedValue(false);
    vi.mocked(loadDueLinks).mockResolvedValue([link({ pvsVendor: "tomedo" })]);
    const s = startScheduler();
    await new Promise((r) => setTimeout(r, 120));
    s.stop();
    expect(claimLink).toHaveBeenCalled();
    expect(poll).not.toHaveBeenCalled();
  });

  it("a claimed link is polled, and a legacy status='error' link is un-tripped first", async () => {
    const poll = vi.fn(async () => ({ events: [], nextCursor: null }));
    _internal.ADAPTERS.tomedo = fakeAdapter(poll);
    vi.mocked(loadDueLinks).mockResolvedValueOnce([link({ pvsVendor: "tomedo", status: "error" })]);
    const s = startScheduler();
    await new Promise((r) => setTimeout(r, 120));
    s.stop();
    expect(restoreLegacyErrorStatus).toHaveBeenCalledWith("L");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("the tick heartbeat keeps beating while a link's work hangs (a slow vendor cannot stall /healthz)", async () => {
    _resetHealth(Date.now() - 10_000);
    _internal.ADAPTERS.tomedo = fakeAdapter((() => new Promise(() => {})) as Adapter["poll"]);
    vi.mocked(loadDueLinks).mockResolvedValue([link({ pvsVendor: "tomedo" })]);
    const before = getSchedulerState().lastTickOkAt;
    const s = startScheduler();
    await new Promise((r) => setTimeout(r, 150));
    const mid = getSchedulerState().lastTickOkAt;
    await new Promise((r) => setTimeout(r, 100));
    const late = getSchedulerState().lastTickOkAt;
    s.stop();
    expect(mid).toBeGreaterThan(before);
    expect(late).toBeGreaterThan(mid);
    expect(getSchedulerState().inFlight).toBe(1); // the hung link is held, not re-dispatched
  });

  it("does not mark a tick OK when the DB listing fails", async () => {
    _resetHealth(Date.now() - 10_000);
    const before = getSchedulerState().lastTickOkAt;
    vi.mocked(loadDueLinks).mockRejectedValue(new Error("db down"));
    const s = startScheduler();
    await new Promise((r) => setTimeout(r, 100));
    s.stop();
    expect(getSchedulerState().lastTickOkAt).toBe(before);
  });
});
