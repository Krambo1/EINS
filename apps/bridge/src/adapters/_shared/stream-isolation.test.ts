import { describe, it, expect, vi, afterEach } from "vitest";
import { pabauAdapter } from "../pabau/index.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { SyncChunk } from "./stream-sync.js";
import { EPOCH, parseCursors, parseResume, seedCursors } from "./stream-sync.js";

/**
 * Stream isolation, mutating result sets and backlog draining in the shared
 * stream engine, driven through the real Pabau adapter against a fake vendor.
 *
 *   finding 1  one failing stream must not block the others (revenue first)
 *   finding 3  page/offset paging over a set that mutates while it is read
 *   finding 9  a backlog over the page cap in non-ascending order
 */

const CLINIC = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-01T12:00:00Z");
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

type Handler = (u: URL) => Response | { rows: unknown[] };
/** Fake Pabau keyed by endpoint name (patients, bookings, treatment_notes, invoices, recalls). */
function fakeVendor(handlers: Partial<Record<string, Handler>>) {
  const requests: URL[] = [];
  globalThis.fetch = vi.fn(async (url: unknown) => {
    const u = new URL(String(url));
    requests.push(u);
    const name = u.pathname.split("/").pop()!;
    const h = handlers[name];
    const r = h ? h(u) : { rows: [] };
    if (r instanceof Response) return r;
    return new Response(JSON.stringify({ data: r.rows }), { status: 200 });
  }) as unknown as typeof fetch;
  return requests;
}

const paid = (id: number, at: string) => ({
  id,
  client_id: 1,
  total: 100,
  status: "paid",
  paid_at: at,
  modified_at: at,
});
const patient = (id: number, at: string) => ({ id, email: `p${id}@b.de`, modified_at: at });
const status = (code: number) => new Response(JSON.stringify({ error: "x" }), { status: code });

/** Pages `rows` by the page/per_page query params. */
function paged(rows: unknown[], perPageOverride?: number): Handler {
  return (u) => {
    const per = perPageOverride ?? Number(u.searchParams.get("per_page"));
    const page = Number(u.searchParams.get("page"));
    return { rows: rows.slice((page - 1) * per, page * per) };
  };
}

async function drain(it: AsyncIterable<SyncChunk>): Promise<{ chunks: SyncChunk[]; error?: Error }> {
  const chunks: SyncChunk[] = [];
  try {
    for await (const c of it) chunks.push(c);
  } catch (err) {
    return { chunks, error: err as Error };
  }
  return { chunks };
}
const kinds = (chunks: SyncChunk[]) => chunks.flatMap((c) => c.events.map((e) => e.kind));
const lastCursor = (chunks: SyncChunk[]) => chunks.filter((c) => c.cursor).at(-1)?.cursor ?? null;

const origFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("finding 1: stream isolation", () => {
  const T = "2026-10-01T10:00:00.000Z";

  it("a 403 on encounters does not block invoices or patients; it is reported as a disabled stream", async () => {
    fakeVendor({
      invoices: paged([paid(7, T)]),
      patients: paged([patient(1, T)]),
      treatment_notes: () => status(403),
    });
    const { chunks, error } = await drain(
      pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now: NOW })
    );
    expect(error).toBeUndefined();
    expect(kinds(chunks)).toEqual(["InvoicePaid", "PatientUpserted"]);
    // Revenue is walked first.
    expect(chunks.find((c) => c.events.length > 0)!.stream).toBe("invoices");
    const disabled = chunks.filter((c) => c.disabledStream);
    expect(disabled).toHaveLength(1);
    expect(disabled[0]!.disabledStream).toMatchObject({ stream: "encounters", status: 403 });
    // Every healthy stream advanced; the disabled one kept its watermark.
    const cur = parseCursors(lastCursor(chunks));
    expect(cur.invoices).toBe(T);
    expect(cur.patients).toBe(T);
    expect(cur.encounters).toBe("2026-10-01T09:00:00.000Z");
  });

  it("a 404 on recalls is also 'disabled'", async () => {
    fakeVendor({ patients: paged([patient(1, T)]), recalls: () => status(404) });
    const { chunks, error } = await drain(pabauAdapter.pollChunks!(link(), null, { now: NOW }));
    expect(error).toBeUndefined();
    expect(chunks.find((c) => c.disabledStream)!.disabledStream).toMatchObject({ stream: "recalls", status: 404 });
  });

  it("a 500 on appointments lets every other stream finish and persist, then rethrows an aggregate error naming the stream", async () => {
    fakeVendor({
      invoices: paged([paid(7, T)]),
      patients: paged([patient(1, T)]),
      bookings: () => status(500),
    });
    const { chunks, error } = await drain(
      pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now: NOW })
    );
    expect(error?.message).toMatch(/appointments: .*500/);
    expect(kinds(chunks)).toEqual(["InvoicePaid", "PatientUpserted"]);
    const cur = parseCursors(lastCursor(chunks));
    expect(cur.invoices).toBe(T);
    expect(cur.patients).toBe(T);
    expect(cur.appointments).toBe("2026-10-01T09:00:00.000Z");
  });

  it("a 403 on a NON-optional stream (invoices) is a real failure, and the other streams still run first", async () => {
    fakeVendor({ invoices: () => status(403), patients: paged([patient(1, T)]) });
    const { chunks, error } = await drain(pabauAdapter.pollChunks!(link(), null, { now: NOW }));
    expect(error?.message).toMatch(/invoices: .*403/);
    expect(chunks.some((c) => c.disabledStream)).toBe(false);
    expect(kinds(chunks)).toEqual(["PatientUpserted"]);
  });

  it("an aborted poll is not turned into a stream failure", async () => {
    const ac = new AbortController();
    globalThis.fetch = vi.fn(
      (_u: unknown, init?: RequestInit) =>
        new Promise((_res, rej) => init!.signal!.addEventListener("abort", () => rej(init!.signal!.reason)))
    ) as unknown as typeof fetch;
    const p = drain(pabauAdapter.pollChunks!(link(), null, { now: NOW, signal: ac.signal }));
    await new Promise((r) => setTimeout(r, 10));
    ac.abort(new Error("deadline"));
    const { error } = await p;
    expect(error?.message).toBe("deadline");
  });
});

describe("finding 3: a result set that mutates while it is paged", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => patient(i + 1, `2026-10-01T10:0${i}:00.000Z`));

  it("holds the watermark when page 1 changed during the walk, so the overlap re-reads the window", async () => {
    const data = rows(5);
    let page1Fetches = 0;
    fakeVendor({
      patients: (u) => {
        const page = Number(u.searchParams.get("page"));
        if (page === 1) {
          page1Fetches += 1;
          // After the first read a new row shows up in front: everything shifts.
          if (page1Fetches === 2) return { rows: [patient(99, "2026-10-01T09:30:00.000Z"), data[0], ] };
        }
        return { rows: data.slice((page - 1) * 2, page * 2) };
      },
    });
    const start = "2026-10-01T09:00:00.000Z";
    const { chunks } = await drain(pabauAdapter.pollChunks!(link(), seedCursors(start), { now: NOW }));
    expect(page1Fetches).toBe(2);
    expect(parseCursors(lastCursor(chunks)).patients).toBe(start); // held
    expect(chunks.filter((c) => c.stream === "patients" && c.cursor).at(-1)!.more).toBeFalsy();
  });

  it("advances normally when page 1 is unchanged", async () => {
    const data = rows(5);
    fakeVendor({ patients: paged(data, 2) });
    const { chunks } = await drain(
      pabauAdapter.pollChunks!(link(), seedCursors("2026-10-01T09:00:00.000Z"), { now: NOW })
    );
    expect(parseCursors(lastCursor(chunks)).patients).toBe("2026-10-01T10:04:00.000Z");
  });

  it("does not spend the extra request on a single-page walk", async () => {
    const reqs = fakeVendor({ patients: paged(rows(2), 5) });
    await drain(pabauAdapter.pollChunks!(link(), null, { now: NOW }));
    const page1 = reqs.filter((u) => u.pathname.endsWith("/patients") && u.searchParams.get("page") === "1");
    expect(page1).toHaveLength(1);
  });
});

describe("finding 9: backlog over the page cap in non-ascending order", () => {
  const backlog = Array.from({ length: 10 }, (_, i) =>
    patient(i + 1, `2026-10-01T10:${String(i).padStart(2, "0")}:00.000Z`)
  ).reverse(); // newest first

  const ids = (chunks: SyncChunk[]) =>
    chunks.flatMap((c) => c.events.map((e) => (e as { pvsPatientId: string }).pvsPatientId));

  it("keeps walking past the cap instead of throwing, and then advances to the newest row", async () => {
    fakeVendor({ patients: paged(backlog, 2) });
    const { chunks, error } = await drain(
      pabauAdapter.pollChunks!(link({ maxPagesPerPoll: 2 }), null, { now: NOW })
    );
    expect(error).toBeUndefined();
    expect([...ids(chunks)].sort((a, b) => Number(a) - Number(b))).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1))
    );
    expect(parseCursors(lastCursor(chunks)).patients).toBe("2026-10-01T10:09:00.000Z");
    expect(parseResume(lastCursor(chunks))).toBeNull();
  });

  it("when the time budget runs out it persists where to continue, and the next poll resumes there", async () => {
    const reqs = fakeVendor({ patients: paged(backlog, 2) });
    // Budget already used up: the poll may read one page, then must stop.
    const first = await drain(
      pabauAdapter.pollChunks!(link({ maxPagesPerPoll: 2 }), null, { now: NOW, deadlineAt: Date.now() - 1 })
    );
    expect(first.error).toBeUndefined();
    expect(ids(first.chunks)).toHaveLength(2);
    const token = lastCursor(first.chunks)!;
    expect(parseCursors(token).patients).toBe(EPOCH); // watermark held while the walk is incomplete
    expect(parseResume(token)).toMatchObject({ stream: "patients", next: 2 });
    expect(first.chunks.at(-1)!.more).toBe(true);

    reqs.length = 0;
    const second = await drain(
      pabauAdapter.pollChunks!(link({ maxPagesPerPoll: 2 }), token, { now: NOW, deadlineAt: Date.now() + 60_000 })
    );
    expect(second.error).toBeUndefined();
    const firstPatientsReq = reqs.find((u) => u.pathname.endsWith("/patients"))!;
    expect(firstPatientsReq.searchParams.get("page")).toBe("2"); // continued, not restarted
    const all = [...ids(first.chunks), ...ids(second.chunks)].sort((a, b) => Number(a) - Number(b));
    expect(all).toEqual(Array.from({ length: 10 }, (_, i) => String(i + 1)));
    // Newest row seen across BOTH polls, resume cleared.
    expect(parseCursors(lastCursor(second.chunks)).patients).toBe("2026-10-01T10:09:00.000Z");
    expect(parseResume(lastCursor(second.chunks))).toBeNull();
  });

  it("an ascending stream that hits the cap without the watermark moving still fails loudly (and only that stream)", async () => {
    const T = "2026-10-01T10:00:00.000Z";
    // Every row shares the watermark timestamp, so reading 2 pages cannot advance it.
    const same = Array.from({ length: 10 }, (_, i) => patient(i + 1, T));
    fakeVendor({ patients: paged(same, 2), invoices: paged([paid(7, T)]) });
    const { chunks, error } = await drain(
      pabauAdapter.pollChunks!(link({ maxPagesPerPoll: 2 }), seedCursors(T), { now: NOW })
    );
    expect(error?.message).toMatch(/patients: .*without the cursor advancing/);
    expect(kinds(chunks)).toContain("InvoicePaid");
  });

  it("ignores a malformed resume part", () => {
    expect(parseResume(`${seedCursors(EPOCH)},patients@x@`)).toBeNull();
    expect(parseResume(`${seedCursors(EPOCH)},nonsense@3@`)).toBeNull();
    expect(parseResume(seedCursors(EPOCH))).toBeNull();
  });
});
