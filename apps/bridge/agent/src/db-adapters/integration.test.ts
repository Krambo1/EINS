import { describe, it, expect, beforeEach, vi } from "vitest";
import { newDb, type IMemoryDb } from "pg-mem";
import Database from "better-sqlite3";

let memDb: IMemoryDb;

vi.mock("pg", () => {
  // beforeEach reassigns `memDb` per test, but vi.mock factories run once
  // on first import. Resolve the current memDb on every `new Client(...)`
  // so the driver under test always sees the active test's seed.
  function Client(opts: unknown) {
    const adapter = memDb.adapters.createPg();
    return new adapter.Client(opts);
  }
  function Pool(opts: unknown) {
    const adapter = memDb.adapters.createPg();
    return new adapter.Pool(opts);
  }
  const exports = { Client, Pool } as unknown as { Client: unknown; Pool: unknown };
  return { default: exports, Client, Pool };
});

import {
  _setStateDbForTesting,
  loadState,
  pendingDriftReports,
  pollOnce,
} from "./framework.js";
import { loadVendorConfigFile } from "./vendor-config.js";
import { PostgresDriver } from "./drivers/postgres.js";
import type { CanonicalEventBase } from "./types.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const TOMEDO_YAML = join(here, "configs", "tomedo.yaml");

beforeEach(() => {
  // Fresh pg-mem instance per test (the vi.mock factory closure picks up
  // `memDb` lazily on first import call, so reassigning it here works
  // because the framework re-requires `pg` from cache only after its first
  // use; for safety we use a single fresh `newDb()` per test).
  memDb = newDb({ noAstCoverageCheck: true });
  seedTomedoSchema(memDb);

  // Fresh in-memory SQLite for framework state.
  const handle = new Database(":memory:");
  handle.exec(`
    CREATE TABLE db_adapter_state (
      vendor_id TEXT NOT NULL,
      stream_kind TEXT NOT NULL,
      cursor TEXT NOT NULL DEFAULT '',
      cursor_tiebreak TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'idle',
      last_run_at INTEGER,
      last_error TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_run_at INTEGER NOT NULL DEFAULT 0,
      column_snapshot TEXT,
      PRIMARY KEY (vendor_id, stream_kind)
    );
    CREATE TABLE db_adapter_drift (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id TEXT NOT NULL,
      stream_kind TEXT NOT NULL,
      expected TEXT NOT NULL,
      observed TEXT NOT NULL,
      missing TEXT NOT NULL,
      added TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      reported_to_portal INTEGER NOT NULL DEFAULT 0,
      report_kind TEXT NOT NULL DEFAULT 'schema_drift',
      detail TEXT
    );
  `);
  _setStateDbForTesting(handle);
});

/**
 * Seed a minimal Tomedo-shaped schema in pg-mem so the bundled tomedo.yaml
 * runs against it cleanly. Column types are coarse on purpose: pg-mem
 * supports a subset of Postgres types and we only need TEXT / TIMESTAMP
 * semantics for the framework's bind values.
 */
function seedTomedoSchema(db: IMemoryDb): void {
  db.public.none(`
    CREATE TABLE patient (
      id INTEGER PRIMARY KEY,
      vorname TEXT,
      nachname TEXT,
      email TEXT,
      telefon_mobil TEXT,
      telefon_privat TEXT,
      geburtsdatum DATE,
      geschlecht TEXT,
      bemerkung TEXT,
      modified_at TIMESTAMP NOT NULL
    );
    CREATE TABLE termin (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      termin_zeit TIMESTAMP NOT NULL,
      behandlung_code TEXT,
      behandlung_name TEXT,
      raum_id INTEGER,
      raum_name TEXT,
      kommentar TEXT,
      status TEXT,
      modified_at TIMESTAMP NOT NULL
    );
    CREATE TABLE behandlung (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      termin_id INTEGER,
      behandlung_zeit TIMESTAMP NOT NULL,
      behandlung_code TEXT,
      behandlung_name TEXT,
      behandler_name TEXT,
      modified_at TIMESTAMP NOT NULL
    );
    CREATE TABLE rechnung (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      termin_id INTEGER,
      behandlung_id INTEGER,
      betrag NUMERIC,
      bezahlt_am TIMESTAMP,
      status TEXT,
      modified_at TIMESTAMP NOT NULL
    );
    CREATE TABLE recall (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      recall_zeit TIMESTAMP NOT NULL,
      behandlung_code TEXT,
      behandlung_name TEXT,
      modified_at TIMESTAMP NOT NULL
    );
  `);

  // One full lead lifecycle: patient → appointment → encounter → invoice.
  db.public.none(`
    INSERT INTO patient (id, vorname, nachname, email, telefon_mobil, geburtsdatum, geschlecht, bemerkung, modified_at)
    VALUES
      (42, 'Maria', 'Müller', 'maria@praxis.de', '+49 30 12345', '1980-06-15', 'w', 'EINS-Lead-ab12cd34', '2026-05-20 10:00:00');

    INSERT INTO termin (id, patient_id, termin_zeit, behandlung_code, behandlung_name, raum_id, raum_name, kommentar, status, modified_at)
    VALUES
      (777, 42, '2026-05-25 14:00:00', 'IGE-001', 'Hyaluron Lippen', 1, 'Behandlungsraum A', 'Erstkonsultation', 'geplant', '2026-05-20 11:00:00');

    INSERT INTO behandlung (id, patient_id, termin_id, behandlung_zeit, behandlung_code, behandlung_name, behandler_name, modified_at)
    VALUES
      (901, 42, 777, '2026-05-25 14:30:00', 'IGE-001', 'Hyaluron Lippen 1.0 ml', 'Dr. Schmidt', '2026-05-25 14:30:00');

    INSERT INTO rechnung (id, patient_id, termin_id, behandlung_id, betrag, bezahlt_am, status, modified_at)
    VALUES
      (5001, 42, 777, 901, 450.00, '2026-05-25 15:00:00', 'bezahlt', '2026-05-25 15:00:00');
  `);
}

describe("integration: pg-mem driven Tomedo poll", () => {
  it("emits a full AppointmentCreated event end-to-end", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const apptStream = vendor.streams.find((s) => s.kind === "AppointmentCreated")!;

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "ignored-by-pg-mem",
    });

    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "11111111-1111-1111-1111-111111111111",
      vendor,
      stream: apptStream,
      driver,
      sink: (event) => collected.push(event),
    });

    expect(outcome.emitted).toBe(1);
    expect(collected).toHaveLength(1);

    const ev = collected[0];
    expect(ev.kind).toBe("AppointmentCreated");
    expect(ev.bridgeSource).toBe("tomedo");
    expect(ev.clinicId).toBe("11111111-1111-1111-1111-111111111111");
    expect(ev.pvsExternalEventId).toBe("tomedo:appointment:777");
    expect(ev.pvsAppointmentId).toBe("777");
    expect(ev.pvsPatientId).toBe("42");
    expect(typeof ev.scheduledAt).toBe("string");
    expect((ev.scheduledAt as string).startsWith("2026-05-25T")).toBe(true);
    expect(ev.treatmentCode).toBe("IGE-001");
    expect(ev.treatmentLabel).toBe("Hyaluron Lippen");
    expect(ev.bemerkung).toBe("Erstkonsultation");

    await driver.close();
  });

  it("emits InvoicePaid with amount in cents", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const stream = vendor.streams.find((s) => s.kind === "InvoicePaid")!;

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "x",
    });

    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: (event) => collected.push(event),
    });

    expect(outcome.emitted).toBe(1);
    const ev = collected[0];
    expect(ev.kind).toBe("InvoicePaid");
    expect(ev.pvsAppointmentId).toBe("777");
    expect(ev.amountCents).toBe(45000);
    expect(ev.currency).toBe("EUR");

    await driver.close();
  });

  it("advances cursor monotonically across two polls", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const stream = vendor.streams.find((s) => s.kind === "AppointmentCreated")!;

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "x",
    });

    const first = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: () => void 0,
    });
    expect(first.emitted).toBe(1);
    const cursorAfterFirst = first.newCursor;
    expect(cursorAfterFirst).not.toBe("");

    // Second poll with same data: cursor doesn't move, no events.
    const second = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: () => void 0,
    });
    expect(second.emitted).toBe(0);
    expect(second.newCursor).toBe(cursorAfterFirst);

    // Insert a newer appointment; third poll picks it up.
    memDb.public.none(`
      INSERT INTO termin (id, patient_id, termin_zeit, behandlung_code, behandlung_name, raum_id, raum_name, kommentar, status, modified_at)
      VALUES
        (778, 42, '2026-06-01 14:00:00', 'IGE-002', 'Botox Stirn', 1, 'Behandlungsraum A', 'Nachsorge', 'geplant', '2026-05-30 09:00:00');
    `);
    const third = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: () => void 0,
    });
    expect(third.emitted).toBe(1);
    expect(third.newCursor > cursorAfterFirst).toBe(true);

    await driver.close();
  });

  // Closes the mock-vs-reality seam in framework.test.ts: those tests inject a
  // synthetic 42703 error, so they prove the classifier logic but not that a
  // REAL renamed column in a real Postgres dialect actually throws an error
  // whose shape isSchemaError() catches. This drives the rename through the
  // real PostgresDriver against pg-mem (review finding 2).
  it("classifies a real renamed column as schema drift and halts the stream", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const stream = vendor.streams.find((s) => s.kind === "AppointmentCreated")!;

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "x",
    });

    // Healthy first poll: emits and snapshots the column set.
    const healthy = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: () => void 0,
    });
    expect(healthy.emitted).toBe(1);
    expect(healthy.driftDetected).toBe(false);

    // A PVS update renames a column the stream's SELECT depends on. The
    // explicit-column query now THROWS "column ... does not exist" rather than
    // returning a different shape, so the column-snapshot detector never sees
    // it; only the error-classifier (finding 2) can catch this.
    memDb.public.none(
      `ALTER TABLE termin RENAME COLUMN termin_zeit TO termin_zeit_v2;`
    );

    const drifted = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: () => {
        throw new Error("sink must not run once the query errors");
      },
    });

    // Loud, not silent: classified as drift, zero events, stream halted, and a
    // report queued for drift-publisher -> /api/pvs/health.
    expect(drifted.driftDetected).toBe(true);
    expect(drifted.emitted).toBe(0);
    expect(drifted.driftReport).not.toBeNull();
    expect(drifted.driftReport!.missing.length).toBeGreaterThan(0);

    const state = loadState(vendor.vendor, "AppointmentCreated");
    expect(state.status).toBe("schema_drift");
    expect(pendingDriftReports().length).toBeGreaterThan(0);

    await driver.close();
  });

  // Review finding 6: keyset pagination. With the old single-column
  // `WHERE modified_at > :cursor`, a cluster of rows that all share one
  // modified_at and overflows a batch was split — the cursor jumped PAST the
  // timestamp and the overflow was never read again. Proven here against a
  // real Postgres dialect by forcing the boundary with a tiny batch size.
  it("emits every row when a batch boundary splits one shared timestamp", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const stream = vendor.streams.find((s) => s.kind === "PatientUpserted")!;
    // Tiny batch so a single shared-timestamp cluster overflows it repeatedly.
    const smallBatch = { ...vendor, batchSize: 3 };

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "x",
    });

    // Replace the seed with one fat cluster of patients that ALL carry the
    // EXACT same modified_at (a bulk import stamps one transaction timestamp
    // on every row), using MIXED-DIGIT-LENGTH ids 9, 10, 11, ..., 100. The
    // mixed lengths are what make this test discriminating: the PK is aliased
    // `id::text AS id`, so a bare `id` in ORDER BY would bind to that TEXT
    // alias and sort LEXICALLY ("100" right after "10", "9" near the end)
    // while the framework advances the tiebreak NUMERICALLY. Under that
    // mismatch the numeric cursor leaps past the lexically-early ids and the
    // rest are never re-read. The old 101-107 seed (all 3-digit) could not
    // expose this, because for equal-length ids lexical order == numeric
    // order. 92 rows also far exceeds batchSize 3, so the cluster spans many
    // batch boundaries.
    memDb.public.none(`DELETE FROM patient;`);
    const ts = "2026-07-01 00:00:00";
    const ids: number[] = [];
    for (let id = 9; id <= 100; id++) ids.push(id);
    for (const id of ids) {
      memDb.public.none(
        `INSERT INTO patient (id, vorname, nachname, email, telefon_mobil, geburtsdatum, geschlecht, bemerkung, modified_at)
         VALUES (${id}, 'P${id}', 'Test', 'p${id}@praxis.de', '+49 30 0', '1980-01-01', 'w', '', '${ts}');`
      );
    }

    const seen: string[] = [];
    // Drain until a poll emits nothing. 92 rows / batchSize 3 = 31 polls plus
    // one empty poll to stop; the cap sits well above that purely as a
    // livelock guard: a regression that re-reads the cluster without advancing
    // the cursor would spin here instead of hanging the suite.
    for (let i = 0; i < 64; i++) {
      const out = await pollOnce({
        clinicId: "c1",
        vendor: smallBatch,
        stream,
        driver,
        sink: (e) => seen.push(String(e.pvsPatientId)),
      });
      if (out.emitted === 0) break;
    }

    // Every patient emitted exactly once: no skip at the boundary (old bug),
    // no duplicate from re-reading the cluster (>= over-correction).
    expect(seen.slice().sort()).toEqual(ids.map(String).sort());
    expect(new Set(seen).size).toBe(ids.length);

    await driver.close();
  });

  // Phase 9: the InvoiceRefunded stream. A Storno / Gutschrift must emit a
  // refund event with a POSITIVE refundedAmountCents (ABS in SQL, because
  // amountToCents rejects negatives), pick up both storno conventions (a
  // negative betrag, or a storno-status row), stay disjoint from InvoicePaid,
  // and leave appt-less refunds without a pvsAppointmentId (the derive worker
  // bridges those via the original invoice id). Driven through the real
  // PostgresDriver against pg-mem so the ABS()/IN()/keyset SQL is parsed and
  // executed, not just validated as a string.
  it("emits InvoiceRefunded with a positive magnitude, disjoint from InvoicePaid", async () => {
    const vendor = await loadVendorConfigFile(TOMEDO_YAML);
    const refundStream = vendor.streams.find((s) => s.kind === "InvoiceRefunded")!;

    // Alongside the seeded paid invoice 5001 (betrag 450, status 'bezahlt'):
    //   6001 = a Gutschrift stored as a NEGATIVE betrag, linked to appt 777
    //   6002 = a 'storniert' row with a POSITIVE betrag and NO appointment
    memDb.public.none(`
      INSERT INTO rechnung (id, patient_id, termin_id, behandlung_id, betrag, bezahlt_am, status, modified_at)
      VALUES
        (6001, 42, 777, 901, -450.00, NULL, 'gutschrift', '2026-05-26 09:00:00'),
        (6002, 42, NULL, NULL, 120.00, NULL, 'storniert', '2026-05-27 09:00:00');
    `);

    const driver = new PostgresDriver();
    await driver.connect({
      host: "127.0.0.1",
      port: 5432,
      database: "tomedo",
      username: "readonly",
      password: "x",
    });

    const refunds: CanonicalEventBase[] = [];
    const out = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: refundStream,
      driver,
      sink: (e) => refunds.push(e),
    });

    expect(out.emitted).toBe(2);
    const byInvoice = new Map(refunds.map((e) => [String(e.pvsInvoiceId), e]));

    // Negative-betrag Gutschrift -> positive magnitude, appointment carried.
    const g = byInvoice.get("6001")!;
    expect(g.kind).toBe("InvoiceRefunded");
    expect(g.refundedAmountCents).toBe(45000);
    expect(g.pvsAppointmentId).toBe("777");
    expect(typeof g.refundedAt).toBe("string");
    // Distinct external-id namespace so a refund can't collide with the paid
    // event for the same invoice id.
    expect(String(g.pvsExternalEventId).startsWith("tomedo:refund:")).toBe(true);

    // Storno on a positive betrag with no appointment -> magnitude still
    // positive, pvsAppointmentId omitted (optional; worker bridges via invoice).
    const s = byInvoice.get("6002")!;
    expect(s.refundedAmountCents).toBe(12000);
    expect(s.pvsAppointmentId).toBeUndefined();

    // The paid invoice 5001 must NOT leak into the refund stream.
    expect(refunds.some((e) => String(e.pvsInvoiceId) === "5001")).toBe(false);

    // Cursor advanced past both storno rows: a second poll is empty.
    const second = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: refundStream,
      driver,
      sink: () => {
        throw new Error("second refund poll must emit nothing");
      },
    });
    expect(second.emitted).toBe(0);

    await driver.close();
  });
});
