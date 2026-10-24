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
    SCHEDULER_TICK_MS: 60_000,
    SCHEDULER_CONCURRENCY: 3,
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
import { _resetHealth } from "../health.js";
import type { Adapter } from "../adapters/Adapter.js";

/**
 * Scheduler behaviour for the bug-hunt findings that live in the scheduler:
 *   1  stream isolation (visible warning for a disabled stream, aggregate failure)
 *   2  permanently rejected events must not advance a stream's cursor
 *   6  free slots are refilled as soon as a link settles
 *   10 SIGTERM releases leases and the process can wait for in-flight work
 * Real portal client, sanitiser, stream engine and Pabau adapter against a fake
 * portal and a fake vendor.
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-01T10:00:00.000Z";
const START = "2026-10-01T09:00:00.000Z";

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

type Verdict = { status: string } | { error: string };
type PortalHandler = (e: Record<string, unknown>) => Verdict;
type VendorHandler = (u: URL) => Response | { rows: unknown[] };

const okPortal: PortalHandler = () => ({ status: "ingested" });

function installFetch(vendor: Record<string, VendorHandler>, portal: PortalHandler = okPortal) {
  globalThis.fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.host === "portal.test") {
      const body = JSON.parse(String(init!.body));
      const batch = u.pathname.endsWith("/batch");
      const events = (batch ? body.events : [body]) as Array<Record<string, unknown>>;
      const results = events.map(portal);
      if (!batch) {
        const r = results[0]!;
        return "error" in r
          ? new Response(JSON.stringify({ error: { code: r.error } }), { status: 400 })
          : new Response(JSON.stringify({ ok: true, status: r.status }), { status: 201 });
      }
      const count = (s: string) => results.filter((r) => "status" in r && r.status === s).length;
      return new Response(
        JSON.stringify({
          ok: true,
          ingested: count("ingested"),
          deduped: 0,
          quarantined: 0,
          errors: results.map((r, idx) => ("error" in r ? { idx, reason: r.error } : null)).filter(Boolean),
          results,
        }),
        { status: 201 }
      );
    }
    const name = u.pathname.split("/").pop()!;
    const h = vendor[name];
    const r = h ? h(u) : { rows: [] };
    if (r instanceof Response) return r;
    return new Response(JSON.stringify({ data: r.rows }), { status: 200 });
  }) as unknown as typeof fetch;
}

/** One page of rows, an empty page afterwards. */
const once = (rows: unknown[]): VendorHandler => (u) => ({
  rows: Number(u.searchParams.get("page")) === 1 ? rows : [],
});
const httpStatus = (code: number) => () => new Response(JSON.stringify({ error: "x" }), { status: code });

const invoice = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  client_id: 1,
  total: 100,
  status: "paid",
  paid_at: T0,
  modified_at: T0,
  ...over,
});
const patient = (id: number) => ({ id, email: `p${id}@b.de`, modified_at: T0 });

const origFetch = globalThis.fetch;
beforeEach(() => {
  _resetPortalClientState();
  _resetHealth();
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
  vi.useRealTimers();
});

const savedCursors = () => vi.mocked(saveProgress).mock.calls.map((c) => c[1].cursor).filter(Boolean) as string[];
// cursor parts: invoices-order is fixed in the token: patients,appointments,encounters,invoices,recalls
const part = (cursor: string, name: "patients" | "appointments" | "encounters" | "invoices" | "recalls") =>
  cursor.split(",")[["patients", "appointments", "encounters", "invoices", "recalls"].indexOf(name)]!;
const seeded = [START, START, START, START, START].join(",");

describe("finding 1: stream isolation in the scheduler", () => {
  it("a 403 on encounters: invoices and patients are posted, the poll succeeds, a visible warning is stored", async () => {
    installFetch({
      invoices: once([invoice(7)]),
      patients: once([patient(1)]),
      treatment_notes: httpStatus(403),
    });
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(checkpointSync).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkpointSync).mock.calls[0]![1].warning).toMatch(/encounters.*not enabled.*403/i);
    const last = savedCursors().at(-1)!;
    expect(part(last, "invoices")).toBe(T0);
    expect(part(last, "patients")).toBe(T0);
    expect(part(last, "encounters")).toBe(START); // the disabled stream keeps its watermark
  });

  it("a 500 on appointments: the other streams persist, then the failure is recorded naming the stream", async () => {
    installFetch({
      invoices: once([invoice(7)]),
      patients: once([patient(1)]),
      bookings: httpStatus(500),
    });
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(checkpointSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/appointments: .*500/);
    const last = savedCursors().at(-1)!;
    expect(part(last, "invoices")).toBe(T0);
    expect(part(last, "patients")).toBe(T0);
    expect(part(last, "appointments")).toBe(START);
  });
});

describe("finding 2: rejected events never advance a stream's cursor", () => {
  const sixInvoices = Array.from({ length: 6 }, (_, i) => invoice(i + 1));

  it("6 of 6 events permanently rejected by the portal: the stream's cursor is held, the failure names the stream and reason", async () => {
    installFetch(
      { invoices: once(sixInvoices), patients: once([patient(1)]) },
      (e) => (e.kind === "InvoicePaid" ? { error: "invalid_envelope" } : { status: "ingested" })
    );
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(checkpointSync).not.toHaveBeenCalled();
    expect(recordFailure).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(recordFailure).mock.calls[0]![1];
    expect(msg).toMatch(/invoices/);
    expect(msg).toMatch(/invalid_envelope x6/);
    for (const c of savedCursors()) expect(part(c, "invoices")).toBe(START);
    // The healthy stream still advanced.
    expect(part(savedCursors().at(-1)!, "patients")).toBe(T0);
  });

  it("sanitizer drops count as rejects too (unsupported currency)", async () => {
    installFetch({ invoices: once(sixInvoices.map((r) => ({ ...r, currency: "USD" }))) });
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordFailure).mock.calls[0]![1]).toMatch(/unsupported_currency x6/);
    for (const c of savedCursors()) expect(part(c, "invoices")).toBe(START);
  });

  it("fewer than 5 rejects: skipped as before, the cursor advances", async () => {
    installFetch({ invoices: once(sixInvoices.slice(0, 4)) }, () => ({ error: "invalid_envelope" }));
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(part(savedCursors().at(-1)!, "invoices")).toBe(T0);
  });

  it("5+ rejects but not more than half of the chunk: skipped, the cursor advances", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => invoice(i + 1));
    installFetch({ invoices: once(rows) }, (e) =>
      Number(e.pvsInvoiceId) <= 5 ? { error: "invalid_envelope" } : { status: "ingested" }
    );
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(part(savedCursors().at(-1)!, "invoices")).toBe(T0);
    // The reject stays visible in last_error (sticky: a poll with rejects never clears it).
    expect(vi.mocked(checkpointSync).mock.calls[0]![1].warning).toMatch(/5 event\(s\) permanently rejected/);
  });

  it("billing_conflict is an operator choice, not a reject", async () => {
    installFetch({ invoices: once(sixInvoices) }, () => ({ error: "billing_conflict" }));
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(part(savedCursors().at(-1)!, "invoices")).toBe(T0);
  });

  it("rows the normalizer legitimately skips (not paid yet) are not rejects", async () => {
    const unpaid = Array.from({ length: 8 }, (_, i) => invoice(i + 1, { status: "draft", paid_at: null }));
    installFetch({ invoices: once(unpaid) });
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).not.toHaveBeenCalled();
    expect(part(savedCursors().at(-1)!, "invoices")).toBe(T0);
  });

  it("a blocked stream is retried next poll and recovers when the portal accepts again", async () => {
    installFetch({ invoices: once(sixInvoices) }, () => ({ error: "invalid_envelope" }));
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(recordFailure).toHaveBeenCalledTimes(1);
    vi.mocked(saveProgress).mockClear();
    _resetPortalClientState();
    installFetch({ invoices: once(sixInvoices) }, okPortal);
    await _internal.runPoll(link({ lastCursor: seeded }), pabauAdapter);
    expect(part(savedCursors().at(-1)!, "invoices")).toBe(T0);
    expect(checkpointSync).toHaveBeenCalledTimes(1);
  });
});

function stubAdapter(over: Partial<Adapter> = {}): Adapter {
  return {
    vendor: "pabau",
    async connect() {
      return { ok: true as const };
    },
    async *initialSync() {},
    ...over,
  };
}

describe("finding 6: free slots are refilled as soon as a link settles", () => {
  it("7 due links with concurrency 3 are all dispatched within ONE tick, never more than 3 at once", async () => {
    vi.useFakeTimers();
    let running = 0;
    let peak = 0;
    const done: string[] = [];
    _internal.ADAPTERS.pabau = stubAdapter({
      async *pollChunks(l) {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1_000));
        running -= 1;
        done.push(l.id);
        yield { events: [], cursor: null };
      },
    });
    vi.mocked(loadDueLinks).mockResolvedValueOnce(
      Array.from({ length: 7 }, (_, i) => link({ id: `L${i}` }))
    );
    const s = startScheduler();
    await vi.advanceTimersByTimeAsync(60_000); // the first tick fires
    await vi.advanceTimersByTimeAsync(10_000); // far less than a second tick interval
    s.stop();
    expect(done.sort()).toEqual(["L0", "L1", "L2", "L3", "L4", "L5", "L6"]);
    expect(peak).toBe(3);
  });
});

describe("finding 10: shutdown releases leases and can wait for in-flight work", () => {
  it("an aborted poll releases the link with a short next-poll time instead of holding the lease", async () => {
    const ac = new AbortController();
    const adapter = stubAdapter({
      async *pollChunks(_l, _c, ctx) {
        await new Promise((_res, rej) => ctx!.signal!.addEventListener("abort", () => rej(ctx!.signal!.reason)));
        yield { events: [], cursor: null };
      },
    });
    const run = _internal.runPoll(link(), adapter, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("scheduler stopped"));
    await run;
    expect(recordFailure).not.toHaveBeenCalled();
    expect(releaseLink).toHaveBeenCalledTimes(1);
    const [id, at] = vi.mocked(releaseLink).mock.calls[0]!;
    expect(id).toBe("L");
    expect(at.getTime() - Date.now()).toBeLessThanOrEqual(10_000);
  });

  it("an aborted initial sync releases the link too", async () => {
    const ac = new AbortController();
    const adapter = stubAdapter({
      async *initialChunks(_l, _s, ctx) {
        await new Promise((_res, rej) => ctx!.signal!.addEventListener("abort", () => rej(ctx!.signal!.reason)));
        yield { events: [], cursor: null };
      },
    });
    const run = _internal.runInitialLoad(link({ initialSyncCompletedAt: null }), adapter, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("scheduler stopped"));
    await run;
    expect(releaseLink).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("a failing release does not escape the shutdown path", async () => {
    vi.mocked(releaseLink).mockRejectedValue(new Error("db gone"));
    const ac = new AbortController();
    const adapter = stubAdapter({
      async *pollChunks(_l, _c, ctx) {
        await new Promise((_res, rej) => ctx!.signal!.addEventListener("abort", () => rej(ctx!.signal!.reason)));
        yield { events: [], cursor: null };
      },
    });
    const run = _internal.runPoll(link(), adapter, { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("scheduler stopped"));
    await expect(run).resolves.toBeUndefined();
  });

  it("idle() resolves once in-flight links have settled (and stop() aborts them)", async () => {
    vi.useFakeTimers();
    let settled = false;
    _internal.ADAPTERS.pabau = stubAdapter({
      async *pollChunks(_l, _c, ctx) {
        try {
          await new Promise((_res, rej) => ctx!.signal!.addEventListener("abort", () => rej(ctx!.signal!.reason)));
        } finally {
          await new Promise((r) => setTimeout(r, 500)); // cleanup takes a moment
          settled = true;
        }
        yield { events: [], cursor: null };
      },
    });
    vi.mocked(loadDueLinks).mockResolvedValueOnce([link()]);
    const s = startScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    s.stop();
    const idle = s.idle(25_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await idle;
    expect(settled).toBe(true);
    expect(releaseLink).toHaveBeenCalled();
  });

  it("idle() gives up after its timeout instead of hanging the exit", async () => {
    vi.useFakeTimers();
    _internal.ADAPTERS.pabau = stubAdapter({
      async *pollChunks() {
        await new Promise(() => {}); // ignores the signal, never settles
        yield { events: [], cursor: null };
      },
    });
    vi.mocked(loadDueLinks).mockResolvedValueOnce([link()]);
    const s = startScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    s.stop();
    const idle = s.idle(25_000);
    await vi.advanceTimersByTimeAsync(25_001);
    await expect(idle).resolves.toBeUndefined();
  });
});
