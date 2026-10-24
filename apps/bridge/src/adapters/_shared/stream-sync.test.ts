import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { pabauAdapter } from "../pabau/index.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import type { SyncChunk } from "./stream-sync.js";
import {
  EPOCH,
  OVERLAP_MS,
  parseCursors,
  parseInitialState,
  seedCursors,
  serializeCursors,
} from "./stream-sync.js";
import { walkPages } from "./paging.js";

/**
 * Stream engine behaviour through the real Pabau adapter + a fake vendor.
 * Covers defects 3 (resumable initial sync), 4 (bounded paging, per-page
 * chunks) and 5 (overlap, future clamp, zone-less timestamps).
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
function link(config: Record<string, unknown> = {}): PvsLinkRow {
  return {
    id: "L",
    clinicId: CLINIC,
    pvsVendor: "pabau",
    status: "connected",
    preferredPath: "auto",
    connectionConfig: { pabauApiToken: "t", ...config },
  };
}

interface Row {
  id: number;
  modified_at: string;
  committed?: boolean;
  email?: string;
}

/** Fake Pabau: only /patients has data. Honours modified_since (>=) and page/per_page; records requests. */
function fakeVendor(
  rows: Row[],
  opts: { ignorePaging?: boolean; perPage?: number; order?: "asc" | "desc" } = {}
) {
  const requests: URL[] = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = new URL(String(url));
    requests.push(u);
    if (!u.pathname.endsWith("/patients")) {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }
    const since = new Date(u.searchParams.get("modified_since")!).getTime();
    const page = Number(u.searchParams.get("page"));
    const per = opts.perPage ?? Number(u.searchParams.get("per_page"));
    let vis = rows
      .filter((r) => r.committed !== false && new Date(r.modified_at).getTime() >= since)
      .sort((a, b) => a.modified_at.localeCompare(b.modified_at));
    if (opts.order === "desc") vis = vis.reverse();
    const slice = opts.ignorePaging ? vis.slice(0, per) : vis.slice((page - 1) * per, page * per);
    return new Response(JSON.stringify({ data: slice }), { status: 200 });
  }) as unknown as typeof fetch;
  return requests;
}

async function drain(it: AsyncIterable<SyncChunk>): Promise<SyncChunk[]> {
  const out: SyncChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}
const eventsOf = (chunks: SyncChunk[]) => chunks.flatMap((c) => c.events);
const lastCursor = (chunks: SyncChunk[]) => chunks.filter((c) => c.cursor).at(-1)?.cursor ?? null;
const patientsCursor = (c: string | null) => c!.split(",")[0]!;

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("cursor codec", () => {
  it("round-trips and tolerates garbage", () => {
    const c = seedCursors("2026-10-01T10:00:00.000Z");
    expect(serializeCursors(parseCursors(c))).toBe(c);
    expect(parseCursors(null).patients).toBe(EPOCH);
    expect(parseCursors("garbage,,2026-10-01T10:00:00Z").appointments).toBe(EPOCH);
    expect(parseCursors("garbage,,2026-10-01T10:00:00Z").encounters).toBe("2026-10-01T10:00:00.000Z");
    // A leftover initial-sync token must not poison the poll cursor.
    expect(parseCursors('{"v":1,"start":"x"}').patients).toBe(EPOCH);
  });
  it("initial-sync token parse is strict", () => {
    expect(parseInitialState(null)).toBeNull();
    expect(parseInitialState("2026-10-01T10:00:00.000Z,a")).toBeNull();
    expect(parseInitialState('{"v":2}')).toBeNull();
    const t = { v: 1, start: "s", since: "t", i: 2, p: 7 };
    expect(parseInitialState(JSON.stringify(t))).toEqual(t);
  });
});

describe("defect 5: overlap, future clamp, zone-less timestamps", () => {
  it("polls from cursor - 10 min", async () => {
    const reqs = fakeVendor([]);
    const cur = "2026-10-01T10:00:00.000Z";
    await drain(pabauAdapter.pollChunks!(link(), seedCursors(cur), { now: new Date("2026-10-01T11:00:00Z") }));
    const since = reqs.find((u) => u.pathname.endsWith("/patients"))!.searchParams.get("modified_since");
    expect(since).toBe(new Date(Date.parse(cur) - OVERLAP_MS).toISOString());
  });

  it("a row whose transaction commits late (modified_at older than the cursor) is delivered by the overlap", async () => {
    const rows: Row[] = [
      { id: 1, email: "a@b.de", modified_at: "2026-10-01T10:00:00.000Z" },
      { id: 2, email: "late@b.de", modified_at: "2026-10-01T10:00:00.000Z", committed: false },
      { id: 3, email: "c@b.de", modified_at: "2026-10-01T10:00:05.000Z" },
    ];
    fakeVendor(rows);
    const now = new Date("2026-10-01T10:05:00Z");
    const seen = new Set<string>();
    const c1 = await drain(pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now }));
    eventsOf(c1).forEach((e) => seen.add((e as { pvsPatientId: string }).pvsPatientId));
    expect(patientsCursor(lastCursor(c1))).toBe("2026-10-01T10:00:05.000Z");
    rows[1]!.committed = true; // commits after poll 1
    const c2 = await drain(pabauAdapter.pollChunks!(link(), lastCursor(c1), { now }));
    eventsOf(c2).forEach((e) => seen.add((e as { pvsPatientId: string }).pvsPatientId));
    expect([...seen].sort()).toEqual(["1", "2", "3"]);
  });

  it("re-reading the overlap yields byte-identical dedup keys (id + occurredAt)", async () => {
    fakeVendor([{ id: 1, email: "a@b.de", modified_at: "2026-10-01T10:00:00.000Z" }]);
    const now = new Date("2026-10-01T10:05:00Z");
    const a = await drain(pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now }));
    const b = await drain(pabauAdapter.pollChunks!(link(), lastCursor(a), { now }));
    const key = (e: CanonicalEvent) => `${e.pvsExternalEventId}|${e.occurredAt}`;
    expect(eventsOf(b).map(key)).toEqual(eventsOf(a).map(key));
  });

  it("a future-dated row cannot park the stream in the future", async () => {
    const rows: Row[] = [
      { id: 1, email: "a@b.de", modified_at: "2026-10-01T10:00:00.000Z" },
      { id: 2, email: "z@b.de", modified_at: "2099-01-01T00:00:00.000Z" },
    ];
    fakeVendor(rows);
    const now = new Date("2026-10-01T10:30:00Z");
    const c1 = await drain(pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now }));
    expect(patientsCursor(lastCursor(c1))).toBe(now.toISOString());
    // A later real change is still requested (cursor is "now", not 2099).
    rows.push({ id: 3, email: "n@b.de", modified_at: "2026-10-02T10:00:00.000Z" });
    const c2 = await drain(
      pabauAdapter.pollChunks!(link(), lastCursor(c1), { now: new Date("2026-10-02T11:00:00Z") })
    );
    expect(eventsOf(c2).map((e) => (e as { pvsPatientId: string }).pvsPatientId)).toContain("3");
  });

  it("a legacy cursor already in the future is clamped back to now", async () => {
    fakeVendor([]);
    const now = new Date("2026-10-01T10:30:00Z");
    const c = await drain(pabauAdapter.pollChunks!(link(), seedCursors("2099-01-01T00:00:00.000Z"), { now }));
    expect(patientsCursor(lastCursor(c))).toBe(now.toISOString());
  });

  it("an empty poll never moves the cursor backwards", async () => {
    fakeVendor([]);
    const cur = "2026-10-01T10:00:00.000Z";
    const c = await drain(pabauAdapter.pollChunks!(link(), seedCursors(cur), { now: new Date("2026-10-01T12:00:00Z") }));
    expect(patientsCursor(lastCursor(c))).toBe(cur);
  });

  it("zone-less vendor timestamps are Berlin wall-clock by default, overridable per link", async () => {
    fakeVendor([{ id: 1, email: "a@b.de", modified_at: "2026-10-01 10:00:00" }]);
    const now = new Date("2026-10-01T12:00:00Z");
    const berlin = await drain(pabauAdapter.pollChunks!(link(), null, { now }));
    const e = eventsOf(berlin)[0]!;
    expect(e.occurredAt).toBe("2026-10-01T08:00:00.000Z"); // CEST = UTC+2
    expect(e.pvsExternalEventId).toBe("pabau:patient:1:2026-10-01T08:00:00.000Z");
    expect(patientsCursor(lastCursor(berlin))).toBe("2026-10-01T08:00:00.000Z");
    const ny = await drain(pabauAdapter.pollChunks!(link({ timezone: "America/New_York" }), null, { now }));
    expect(eventsOf(ny)[0]!.occurredAt).toBe("2026-10-01T14:00:00.000Z"); // EDT = UTC-4
    const bogus = await drain(pabauAdapter.pollChunks!(link({ timezone: "Not/AZone" }), null, { now }));
    expect(eventsOf(bogus)[0]!.occurredAt).toBe("2026-10-01T08:00:00.000Z"); // falls back to Berlin
  });

  it("timestamps WITH an offset ignore the link timezone", async () => {
    fakeVendor([{ id: 1, email: "a@b.de", modified_at: "2026-10-01T10:00:00Z" }]);
    const c = await drain(
      pabauAdapter.pollChunks!(link({ timezone: "America/New_York" }), null, { now: new Date("2026-10-01T12:00:00Z") })
    );
    expect(eventsOf(c)[0]!.occurredAt).toBe("2026-10-01T10:00:00.000Z");
  });
});

describe("defect 4: bounded, chunked, honest paging", () => {
  it("yields one chunk per vendor page (memory bounded by a page)", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      email: `p${i}@b.de`,
      modified_at: `2026-10-01T10:0${i}:00.000Z`,
    }));
    fakeVendor(rows, { perPage: 2 });
    const chunks = await drain(
      pabauAdapter.pollChunks!(link(), null, { now: new Date("2026-10-01T12:00:00Z") })
    );
    const withEvents = chunks.filter((c) => c.events.length > 0);
    expect(withEvents.map((c) => c.events.length)).toEqual([2, 2, 1]);
    // The poll cursor arrives only after the stream drained.
    expect(chunks.filter((c) => c.cursor)).toHaveLength(5); // one per stream
  });

  it("stops and errors when the vendor ignores paging (same first id on consecutive pages)", async () => {
    const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({
      id: i + 1,
      email: `p${i}@b.de`,
      modified_at: "2026-10-01T10:00:00.000Z",
    }));
    const reqs = fakeVendor(rows, { ignorePaging: true });
    await expect(
      drain(pabauAdapter.pollChunks!(link(), null, { now: new Date("2026-10-01T12:00:00Z") }))
    ).rejects.toThrow(/ignores paging/);
    expect(reqs.filter((u) => u.pathname.endsWith("/patients"))).toHaveLength(2);
  });

  it("caps pages per poll; with ascending order the cursor advances to the newest row seen and `more` is set", async () => {
    const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      email: `p${i}@b.de`,
      modified_at: `2026-10-01T10:${String(i).padStart(2, "0")}:00.000Z`,
    }));
    fakeVendor(rows, { perPage: 2 });
    const chunks = await drain(
      pabauAdapter.pollChunks!(link({ maxPagesPerPoll: 2 }), null, { now: new Date("2026-10-01T12:00:00Z") })
    );
    expect(eventsOf(chunks)).toHaveLength(4); // 2 pages x 2 rows
    // Streams run revenue first; pick the patients stream by its tag.
    const patientsDone = chunks.find((c) => c.cursor && c.stream === "patients")!;
    expect(patientsDone.more).toBe(true);
    expect(patientsCursor(patientsDone.cursor)).toBe("2026-10-01T10:03:00.000Z");
  });

  // (The old "page cap + descending order throws forever" case is replaced by
  // stream-isolation.test.ts, finding 9: the walk now continues past the cap.)

  it("aborting the signal cancels the in-flight vendor request (no zombie paging)", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          calls += 1;
          init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason));
        })
    ) as unknown as typeof fetch;
    const ac = new AbortController();
    const p = drain(pabauAdapter.pollChunks!(link(), null, { signal: ac.signal, now: new Date() }));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("deadline"));
    await expect(p).rejects.toThrow("deadline");
    const after = calls;
    await new Promise((r) => setTimeout(r, 30));
    expect(calls).toBe(after);
  });
});

describe("walkPages", () => {
  it("terminates on an empty page, not a short one (H17)", async () => {
    const pages = [[{ id: 1 }, { id: 2 }], [{ id: 3 }], []];
    const got: number[] = [];
    for await (const p of walkPages({
      label: "t",
      startAt: 1,
      maxPages: 50,
      fetchPage: async (at) => pages[at - 1]!,
      advance: (at) => at + 1,
    })) {
      got.push(p.rows.length);
    }
    expect(got).toEqual([2, 1]);
  });
});

describe("defect 3: resumable initial sync", () => {
  const state = { v: 1 as const, start: "2026-10-01T09:00:00.000Z", since: "2025-10-01T09:00:00.000Z", i: 0, p: null };

  it("emits a resume token after every page that points at the NEXT page", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: i + 1,
      email: `p${i}@b.de`,
      modified_at: `2026-09-01T10:0${i}:00.000Z`,
    }));
    fakeVendor(rows, { perPage: 2 });
    const chunks = await drain(pabauAdapter.initialChunks!(link(), state, {}));
    const tokens = chunks.filter((c) => c.events.length > 0).map((c) => parseInitialState(c.cursor)!);
    expect(tokens.map((t) => [t.i, t.p])).toEqual([
      [0, 2],
      [0, 3],
      [0, 4],
    ]);
    // All 5 streams are walked; the last chunk says "everything done".
    expect(parseInitialState(chunks.at(-1)!.cursor)).toMatchObject({ i: 5, p: null });
    expect(eventsOf(chunks)).toHaveLength(5);
  });

  it("resumes at the saved page instead of re-reading from the start", async () => {
    const rows: Row[] = Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      email: `p${i}@b.de`,
      modified_at: `2026-09-01T10:0${i}:00.000Z`,
    }));
    const reqs = fakeVendor(rows, { perPage: 2 });
    // Simulate a crash after page 1: consume exactly one page, keep its token.
    let token: string | null = null;
    for await (const c of pabauAdapter.initialChunks!(link(), state, {})) {
      token = c.cursor;
      if (c.events.length > 0) break;
    }
    const resumeState = parseInitialState(token)!;
    expect(resumeState).toMatchObject({ i: 0, p: 2, start: state.start });
    reqs.length = 0;
    const rest = await drain(pabauAdapter.initialChunks!(link(), resumeState, {}));
    const firstPatientsReq = reqs.find((u) => u.pathname.endsWith("/patients"))!;
    expect(firstPatientsReq.searchParams.get("page")).toBe("2");
    expect(firstPatientsReq.searchParams.get("modified_since")).toBe(state.since);
    // Pages 2 and 3 only: ids 3..6.
    expect(eventsOf(rest).map((e) => (e as { pvsPatientId: string }).pvsPatientId)).toEqual(["3", "4", "5", "6"]);
  });

  it("a token already past the last stream completes without any request", async () => {
    const reqs = fakeVendor([]);
    const chunks = await drain(pabauAdapter.initialChunks!(link(), { ...state, i: 5 }, {}));
    expect(chunks).toHaveLength(0);
    expect(reqs).toHaveLength(0);
  });

  it("seedCursor hands the poller the FIRST run's start for every stream", () => {
    const seeded = pabauAdapter.seedCursor!(state.start);
    expect(seeded).toBe(Array(5).fill(state.start).join(","));
  });
});
