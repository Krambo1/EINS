/**
 * C8: confirmCsvMapping starts the ingest inline via after() (no worker),
 * and a double submit confirms only once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  row: null as Record<string, unknown> | null,
  confirmRows: [] as unknown[],
  afterFns: [] as Array<() => Promise<void>>,
  runs: [] as string[],
  runThrows: false,
}));

vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => {
    state.afterFns.push(fn);
  },
}));
vi.mock("@/auth/guards", () => ({
  requireSession: async () => ({ clinicId: "c1", userId: "u1", role: "inhaber" }),
}));
vi.mock("@/lib/roles", () => ({ can: () => true }));
vi.mock("@/server/audit", () => ({ writeAudit: async () => undefined }));
vi.mock("@/server/storage", () => ({ getStorage: () => ({}) }));
vi.mock("@/worker/processors/pvs-csv-ingest", () => ({
  runPvsCsvIngest: async (id: string) => {
    state.runs.push(id);
    if (state.runThrows) throw new Error("timeout");
    return "processed";
  },
}));
vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  const chain = (result: () => unknown[]) => {
    const p = () => Promise.resolve(result());
    const o: Record<string, unknown> = {};
    for (const k of ["from", "where", "set", "values"]) o[k] = () => o;
    o.limit = p;
    o.returning = p;
    o.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      p().then(res, rej);
    return o;
  };
  return {
    schema,
    db: {
      // confirm reads the upload, then ensureCsvLink reads pvs_link (none).
      select: vi.fn(() => {
        const first = state.row;
        state.row = null;
        return chain(() => (first ? [first] : []));
      }),
      update: () => chain(() => state.confirmRows),
      insert: () => chain(() => []),
    },
  };
});

import { confirmCsvMapping } from "./pvs-csv-upload";

const UPLOAD = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const MAPPING = {
  stream: "invoices",
  columns: {
    pvsPatientId: "Pat.-Nr.",
    pvsInvoiceId: "Rechnungsnummer",
    amount: "Betrag",
    paidAt: "Zahldatum",
  },
  allRowsPaidConfirmed: true,
} as const;

describe("confirmCsvMapping (C8)", () => {
  beforeEach(() => {
    state.row = { id: UPLOAD, clinicId: "c1", status: "pending", stream: "invoices" };
    state.confirmRows = [{ id: UPLOAD }];
    state.afterFns = [];
    state.runs = [];
    state.runThrows = false;
  });

  it("schedules the ingest inline via after(), not before the response", async () => {
    const res = await confirmCsvMapping({ uploadId: UPLOAD, mapping: MAPPING as never });
    expect(res).toEqual({ ok: true });
    expect(state.runs).toEqual([]); // nothing ran during the action itself
    expect(state.afterFns).toHaveLength(1);
    await state.afterFns[0]!();
    expect(state.runs).toEqual([UPLOAD]);
  });

  it("a failing inline run is logged without data and does not throw", async () => {
    state.runThrows = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await confirmCsvMapping({ uploadId: UPLOAD, mapping: MAPPING as never });
    await expect(state.afterFns[0]!()).resolves.toBeUndefined();
    const line = String(err.mock.calls[0]?.[0]);
    expect(line).toContain("pvs-csv-upload");
    expect(line).toContain(UPLOAD);
    err.mockRestore();
  });

  it("a second confirm that lost the race starts nothing", async () => {
    state.confirmRows = []; // the guarded UPDATE matched no pending row
    const res = await confirmCsvMapping({ uploadId: UPLOAD, mapping: MAPPING as never });
    expect(res).toEqual({ ok: false, error: "upload_already_processing" });
    expect(state.afterFns).toHaveLength(0);
  });
});
