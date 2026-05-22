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
      reported_to_portal INTEGER NOT NULL DEFAULT 0
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
});
