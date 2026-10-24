import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  upload: null as Record<string, unknown> | null,
  csv: Buffer.alloc(0),
  liveIds: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  applied: [] as Array<Record<string, unknown>>,
  /** C8: does the atomic claim UPDATE match (the SQL itself: db test)? */
  claimable: true,
  /** C8: does the attempt-limit UPDATE match? */
  exhaustable: false,
  claims: 0,
  progressWriteThrows: false,
}));

vi.mock("@/db/client", async () => {
  const schema = await import("@/db/schema");
  return {
    schema,
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: () => Promise.resolve(state.upload ? [state.upload] : []),
          }),
        }),
      }),
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve(state.liveIds.map((id) => ({ id }))),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          // The claim sets ingestAttempts, the attempt-limit path sets
          // reason attempts_exhausted; both use .returning().
          let rows: unknown[] = [];
          if ("ingestAttempts" in vals) {
            state.claims += 1;
            rows = state.claimable && state.upload ? [state.upload] : [];
          } else {
            if (state.progressWriteThrows && "totalRows" in vals) {
              throw new Error("boom");
            }
            state.updates.push(vals);
            const summary = vals.errorSummary as { reason?: string } | undefined;
            if (summary?.reason === "attempts_exhausted") {
              rows = state.exhaustable ? [{ id: ID }] : [];
            }
          }
          const result = Promise.resolve(rows);
          return {
            where: () =>
              Object.assign(Promise.resolve([]), {
                returning: () => result,
              }),
          };
        },
      }),
    },
  };
});
vi.mock("@/server/storage", () => ({
  getStorage: () => ({ read: async () => state.csv }),
}));
vi.mock("@/server/pvs-events", () => ({
  applyPvsEvent: vi.fn(async (e: Record<string, unknown>) => {
    state.applied.push(e);
    return { ok: true, status: "ingested" };
  }),
}));

import {
  CSV_INGEST_MAX_ATTEMPTS,
  processPvsCsvIngest,
  runPvsCsvIngest,
} from "./pvs-csv-ingest";

const CLINIC = "11111111-2222-3333-4444-555555555555";
const ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function setup(csv: string, mapping: Record<string, unknown>) {
  state.csv = Buffer.from(csv, "utf8");
  state.upload = {
    id: ID,
    clinicId: CLINIC,
    storageKey: "k",
    stream: "invoices",
    status: "processing",
    mappingJson: mapping,
  };
}

const MAPPING = {
  stream: "invoices",
  columns: {
    pvsPatientId: "Pat.-Nr.",
    pvsInvoiceId: "Rechnungsnummer",
    amount: "Betrag",
    paidAt: "Zahldatum",
  },
  allRowsPaidConfirmed: true,
};

const last = () => state.updates[state.updates.length - 1]!;

describe("processPvsCsvIngest", () => {
  beforeEach(() => {
    state.liveIds = [];
    state.updates = [];
    state.applied = [];
    state.claimable = true;
    state.exhaustable = false;
    state.claims = 0;
    state.progressWriteThrows = false;
  });

  it("applies a German export end to end", async () => {
    setup(
      "Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\r\nP-1;R-1;350,00;07.10.2026\r\nP-2;R-2;1.234,50;25.10.2026\r\n",
      MAPPING
    );
    await processPvsCsvIngest({ uploadId: ID });
    expect(state.applied).toHaveLength(2);
    expect(state.applied[0]).toMatchObject({ kind: "InvoicePaid", amountCents: 35000 });
    expect(last()).toMatchObject({ status: "completed" });
  });

  it("skips invoices a live PVS source already recorded", async () => {
    state.liveIds = ["R-1"];
    setup(
      "Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\nP-1;R-1;350,00;07.10.2026\nP-2;R-2;100,00;08.10.2026\n",
      MAPPING
    );
    await processPvsCsvIngest({ uploadId: ID });
    expect(state.applied.map((e) => e.pvsInvoiceId)).toEqual(["R-2"]);
    expect(last()).toMatchObject({
      status: "completed",
      errorSummary: { applied: 1, alreadyViaPvs: 1 },
    });
  });

  it("applies nothing and fails when more than 5% of rows are invalid", async () => {
    const good = "P-1;R-1;350,00;07.10.2026\n";
    const bad = "P-2;R-2;kaputt;08.10.2026\n";
    setup("Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\n" + good + bad, MAPPING);
    await processPvsCsvIngest({ uploadId: ID });
    expect(state.applied).toHaveLength(0);
    expect(last()).toMatchObject({
      status: "failed",
      errorSummary: { reason: "error_rate_exceeded", applied: 0, totalErrors: 1 },
    });
  });

  it("fails without applying when no status column and no confirmation", async () => {
    setup("Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\nP-1;R-1;350,00;07.10.2026\n", {
      ...MAPPING,
      allRowsPaidConfirmed: false,
    });
    await processPvsCsvIngest({ uploadId: ID });
    expect(state.applied).toHaveLength(0);
    expect(last()).toMatchObject({ status: "failed" });
  });

  // ---- C8: claim (the claim SQL itself is covered by pvs-csv-ingest.db.test.ts)

  const GOOD = "Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\nP-1;R-1;350,00;07.10.2026\n";

  it("claims before doing anything and processes when the claim is won", async () => {
    setup(GOOD, MAPPING);
    expect(await runPvsCsvIngest(ID)).toBe("processed");
    expect(state.claims).toBe(1);
    expect(state.applied).toHaveLength(1);
    expect(last()).toMatchObject({ status: "completed" });
  });

  it("does nothing when another runner holds the claim", async () => {
    setup(GOOD, MAPPING);
    state.claimable = false;
    expect(await runPvsCsvIngest(ID)).toBe("not_claimed");
    expect(state.applied).toHaveLength(0);
    // Only the (non-matching) attempt-limit UPDATE was tried, no progress.
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toMatchObject({
      errorSummary: { reason: "attempts_exhausted" },
    });
  });

  it("marks the upload failed with a German message at the attempt limit", async () => {
    setup(GOOD, MAPPING);
    state.claimable = false;
    state.exhaustable = true;
    expect(await runPvsCsvIngest(ID)).toBe("exhausted");
    expect(state.applied).toHaveLength(0);
    const u = last();
    expect(u).toMatchObject({
      status: "failed",
      errorSummary: { reason: "attempts_exhausted" },
    });
    const msg = (u.errorSummary as { message: string }).message;
    expect(msg).toMatch(/kleinere Dateien/);
    expect(msg).not.toContain("\u2014");
    expect(CSV_INGEST_MAX_ATTEMPTS).toBeGreaterThan(1);
  });

  it("releases the claim and rethrows when a run crashes", async () => {
    setup(GOOD, MAPPING);
    // A throw outside the per-row try/catch (e.g. DB gone mid-run).
    state.progressWriteThrows = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runPvsCsvIngest(ID)).rejects.toThrow("boom");
    expect(last()).toEqual({ claimedAt: null });
    expect(String(err.mock.calls[0]?.[0])).toContain("pvs-csv-ingest");
    err.mockRestore();
  });

  it("refreshes the claim while it makes progress (heartbeat)", async () => {
    setup(GOOD, MAPPING);
    await runPvsCsvIngest(ID);
    expect(state.updates.some((u) => "claimedAt" in u && u.claimedAt !== null)).toBe(true);
  });
});
