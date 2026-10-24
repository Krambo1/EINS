/**
 * C8 ingest claim (migration 0095) against a REAL local Postgres: two runners
 * at once, stale claim retry, attempt limit, cron catch-up, archived Praxis.
 * Storage is mocked (the CSV bytes); applyPvsEvent is the real one, wrapped to
 * count calls. Two throwaway Praxen are created and deleted again (cascade).
 *
 * Opt-in only, it writes to the DB named in DATABASE_URL (the vitest setup
 * overrides it, so export it from .env.local first):
 *   PVS_CSV_DB_TEST=1 DATABASE_URL=... npx vitest run src/worker/processors/pvs-csv-ingest.db.test.ts
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const enabled = process.env.PVS_CSV_DB_TEST === "1";

const CSV = Buffer.from(
  "Pat.-Nr.;Rechnungsnummer;Betrag;Zahldatum\n" +
    "C8-P1;C8-R1;350,00;07.10.2026\n" +
    "C8-P2;C8-R2;1.234,50;08.10.2026\n",
  "utf8"
);
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

const applyCalls = vi.hoisted(() => ({ n: 0 }));
vi.mock("@/server/storage", () => ({
  getStorage: () => ({
    read: async () => {
      // Let a concurrent runner reach its claim while this one holds it.
      await new Promise((r) => setTimeout(r, 50));
      return CSV;
    },
  }),
}));
vi.mock("@/server/pvs-events", async (orig) => {
  const real = await orig<typeof import("@/server/pvs-events")>();
  return {
    ...real,
    applyPvsEvent: async (...args: Parameters<typeof real.applyPvsEvent>) => {
      applyCalls.n += 1;
      return real.applyPvsEvent(...args);
    },
  };
});

const live = randomUUID();
const archived = randomUUID();

describe.skipIf(!enabled)("pvs-csv-ingest claim (local DB)", () => {
  async function q<T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...vals: unknown[]
  ): Promise<T[]> {
    const { db } = await import("@/db/client");
    const { sql } = await import("drizzle-orm");
    return (await db.execute(sql(strings, ...vals))) as unknown as T[];
  }

  async function seed(
    clinicId: string,
    opts: { claimedMinutesAgo?: number; attempts?: number } = {}
  ): Promise<string> {
    const id = randomUUID();
    const claimed =
      opts.claimedMinutesAgo === undefined
        ? null
        : new Date(Date.now() - opts.claimedMinutesAgo * 60_000).toISOString();
    await q`
      INSERT INTO pvs_csv_uploads
        (id, clinic_id, storage_key, original_filename, stream, mapping_json,
         status, claimed_at, ingest_attempts, started_at)
      VALUES (${id}, ${clinicId}, ${`pvs-csv-uploads/${clinicId}/${id}.csv`},
              'c8.csv', 'invoices', ${JSON.stringify(MAPPING)}::jsonb,
              'processing', ${claimed}::timestamptz, ${opts.attempts ?? 0}, now())`;
    return id;
  }

  async function upload(id: string) {
    const [r] = await q<{
      status: string;
      ingest_attempts: number;
      claimed_at: Date | null;
      processed_rows: number;
      error_summary: Record<string, unknown> | null;
    }>`SELECT status, ingest_attempts, claimed_at, processed_rows, error_summary
         FROM pvs_csv_uploads WHERE id = ${id}`;
    return r!;
  }

  beforeAll(async () => {
    for (const [id, arch] of [
      [live, false],
      [archived, true],
    ] as const) {
      await q`
        INSERT INTO clinics (id, legal_name, display_name, slug, archived_at)
        VALUES (${id}, 'C8 Test', 'C8 Test', ${`c8-test-${id}`},
                ${arch ? new Date().toISOString() : null}::timestamptz)`;
      await q`
        INSERT INTO pvs_link (clinic_id, pvs_vendor, status, connection_config)
        VALUES (${id}, 'csv_upload', 'connected', '{}'::jsonb)`;
    }
  });

  afterAll(async () => {
    await q`DELETE FROM pvs_event_log WHERE clinic_id IN (${live}, ${archived})`;
    await q`DELETE FROM clinics WHERE id IN (${live}, ${archived})`;
  });

  it("two runners at once: exactly one processes, the file is applied once", async () => {
    const { runPvsCsvIngest } = await import("./pvs-csv-ingest");
    const id = await seed(live);
    applyCalls.n = 0;
    const outcomes = await Promise.all([runPvsCsvIngest(id), runPvsCsvIngest(id)]);
    expect(outcomes.sort()).toEqual(["not_claimed", "processed"]);
    expect(applyCalls.n).toBe(2); // two CSV rows, once each
    const r = await upload(id);
    expect(r.status).toBe("completed");
    expect(r.ingest_attempts).toBe(1);
    expect(r.processed_rows).toBe(2);
    expect(r.error_summary).toMatchObject({ applied: 2, totalErrors: 0 });

    // A later runner (worker, cron) finds nothing to do.
    applyCalls.n = 0;
    expect(await runPvsCsvIngest(id)).toBe("not_claimed");
    expect(applyCalls.n).toBe(0);

    // End to end: the invoices really landed in the event log.
    const [{ n }] = await q<{ n: number }>`
      SELECT count(*)::int AS n FROM pvs_event_log
       WHERE clinic_id = ${live} AND kind = 'InvoicePaid'
         AND payload->>'pvsInvoiceId' IN ('C8-R1', 'C8-R2')`;
    expect(n).toBe(2);
  });

  it("a fresh claim is left alone, a stale one is retried by the catch-up", async () => {
    const { runPvsCsvIngest, catchUpPvsCsvIngest } = await import("./pvs-csv-ingest");
    const fresh = await seed(live, { claimedMinutesAgo: 1, attempts: 1 });
    const stale = await seed(live, { claimedMinutesAgo: 20, attempts: 1 });
    expect(await runPvsCsvIngest(fresh)).toBe("not_claimed");

    const out = await catchUpPvsCsvIngest({ limit: 50 });
    expect(out.processed).toBeGreaterThanOrEqual(1);
    expect((await upload(fresh)).status).toBe("processing");
    const s = await upload(stale);
    expect(s.status).toBe("completed");
    expect(s.ingest_attempts).toBe(2);
    // Re-applying a partly applied file is deduped by applyPvsEvent.
    expect(s.error_summary).toMatchObject({ totalErrors: 0 });
    await q`UPDATE pvs_csv_uploads SET status = 'cancelled' WHERE id = ${fresh}`;
  });

  it("attempt limit: a stale claim at the limit is failed with the German message", async () => {
    const { runPvsCsvIngest, CSV_INGEST_MAX_ATTEMPTS, ATTEMPTS_EXHAUSTED_MESSAGE } =
      await import("./pvs-csv-ingest");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const atLimitFresh = await seed(live, {
      claimedMinutesAgo: 1,
      attempts: CSV_INGEST_MAX_ATTEMPTS,
    });
    const atLimitStale = await seed(live, {
      claimedMinutesAgo: 20,
      attempts: CSV_INGEST_MAX_ATTEMPTS,
    });
    applyCalls.n = 0;
    // Still running (fresh claim): not failed yet.
    expect(await runPvsCsvIngest(atLimitFresh)).toBe("not_claimed");
    expect((await upload(atLimitFresh)).status).toBe("processing");
    // Dead and out of attempts: failed, nothing applied.
    expect(await runPvsCsvIngest(atLimitStale)).toBe("exhausted");
    expect(applyCalls.n).toBe(0);
    const r = await upload(atLimitStale);
    expect(r.status).toBe("failed");
    expect(r.error_summary).toEqual({
      reason: "attempts_exhausted",
      message: ATTEMPTS_EXHAUSTED_MESSAGE,
    });
    await q`UPDATE pvs_csv_uploads SET status = 'cancelled' WHERE id = ${atLimitFresh}`;
    warn.mockRestore();
  });

  it("the catch-up skips archived Praxen and never touches pending uploads", async () => {
    const { catchUpPvsCsvIngest } = await import("./pvs-csv-ingest");
    const inArchived = await seed(archived);
    const pending = randomUUID();
    await q`
      INSERT INTO pvs_csv_uploads
        (id, clinic_id, storage_key, original_filename, stream, mapping_json, status)
      VALUES (${pending}, ${live}, 'k', 'p.csv', 'invoices', '{}'::jsonb, 'pending')`;
    await catchUpPvsCsvIngest({ limit: 50 });
    expect((await upload(inArchived)).status).toBe("processing");
    expect((await upload(inArchived)).ingest_attempts).toBe(0);
    expect((await upload(pending)).status).toBe("pending");
  });
});
