import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqliteDriver } from "./drivers/sqlite.js";
import { _setStateDbForTesting, pollOnce } from "./framework.js";
import type { CanonicalEventBase } from "./types.js";
import { loadVendorConfigFile } from "./vendor-config.js";

/**
 * SQLite end-to-end integration. Pixelmedics ships as a hypothesis-
 * mode SQLite config; this test seeds a real SQLite file matching the
 * YAML's expected column names, runs pollOnce, and asserts the
 * canonical envelope arrives at the sink with the correct mapping.
 *
 * Doubles as the "first run does not crash on schema drift" assertion:
 * the framework should write the column snapshot on first poll and
 * subsequent polls should match.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PIXEL_YAML = join(HERE, "configs", "pixelmedics.yaml");

let tmp: string;
let dbPath: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eins-pixel-test-"));
  dbPath = join(tmp, "pixelmedics.sqlite");
  const seed = new BetterSqlite3(dbPath);
  seed.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      first_name TEXT,
      last_name TEXT,
      email TEXT,
      phone_mobile TEXT,
      phone_home TEXT,
      date_of_birth TEXT,
      gender TEXT,
      notes TEXT,
      modified_at TEXT NOT NULL
    );
    CREATE TABLE appointments (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      scheduled_at TEXT NOT NULL,
      treatment_code TEXT,
      treatment_name TEXT,
      room_id INTEGER,
      room_name TEXT,
      notes TEXT,
      status TEXT,
      modified_at TEXT NOT NULL
    );
    CREATE TABLE encounters (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      completed_at TEXT NOT NULL,
      treatment_code TEXT,
      treatment_name TEXT,
      practitioner_name TEXT,
      modified_at TEXT NOT NULL
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      appointment_id INTEGER,
      encounter_id INTEGER,
      amount_total REAL,
      paid_at TEXT,
      status TEXT,
      modified_at TEXT NOT NULL
    );
    CREATE TABLE recalls (
      id INTEGER PRIMARY KEY,
      patient_id INTEGER NOT NULL,
      recall_at TEXT NOT NULL,
      treatment_code TEXT,
      treatment_name TEXT,
      modified_at TEXT NOT NULL
    );

    INSERT INTO patients (id, first_name, last_name, email, phone_mobile, date_of_birth, gender, notes, modified_at)
    VALUES (10, 'Lea', 'Beispiel', 'lea@praxis.de', '+49 30 9999', '1990-04-01', 'w', 'EINS-Lead-12345678', '2026-05-20T10:00:00.000Z');

    INSERT INTO appointments (id, patient_id, scheduled_at, treatment_code, treatment_name, room_id, room_name, notes, status, modified_at)
    VALUES (200, 10, '2026-06-01T14:00:00.000Z', 'BOT-1', 'Botox Stirn', 1, 'Behandlungsraum 1', 'Erstgespräch', 'scheduled', '2026-05-20T11:00:00.000Z');

    INSERT INTO invoices (id, patient_id, appointment_id, encounter_id, amount_total, paid_at, status, modified_at)
    VALUES (5000, 10, 200, NULL, 250.0, '2026-06-01T15:00:00.000Z', 'paid', '2026-06-01T15:00:00.000Z');
  `);
  seed.close();

  // Fresh in-memory framework state per test.
  const handle = new BetterSqlite3(":memory:");
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

afterEach(() => {
  _setStateDbForTesting(null);
  rmSync(tmp, { recursive: true, force: true });
});

describe("integration: Pixelmedics SQLite end-to-end", () => {
  it("emits a full AppointmentCreated event from the seeded SQLite file", async () => {
    const vendor = await loadVendorConfigFile(PIXEL_YAML);
    const apptStream = vendor.streams.find((s) => s.kind === "AppointmentCreated")!;
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });

    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "22222222-2222-2222-2222-222222222222",
      vendor,
      stream: apptStream,
      driver,
      sink: (event) => collected.push(event),
    });

    expect(outcome.emitted).toBe(1);
    const ev = collected[0];
    expect(ev.kind).toBe("AppointmentCreated");
    expect(ev.bridgeSource).toBe("pixelmedics");
    expect(ev.pvsExternalEventId).toBe("pixelmedics:appointment:200");
    expect(ev.pvsAppointmentId).toBe("200");
    expect(ev.pvsPatientId).toBe("10");
    expect(ev.treatmentCode).toBe("BOT-1");
    expect(ev.treatmentLabel).toBe("Botox Stirn");
    await driver.close();
  });

  it("emits InvoicePaid with amountCents converted from REAL EUR", async () => {
    const vendor = await loadVendorConfigFile(PIXEL_YAML);
    const stream = vendor.streams.find((s) => s.kind === "InvoicePaid")!;
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
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
    expect(ev.pvsAppointmentId).toBe("200");
    expect(ev.amountCents).toBe(25000);
    expect(ev.currency).toBe("EUR");
    await driver.close();
  });

  it("second poll returns nothing new (cursor advance + idempotency)", async () => {
    const vendor = await loadVendorConfigFile(PIXEL_YAML);
    const stream = vendor.streams.find((s) => s.kind === "AppointmentCreated")!;
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });
    const first = await pollOnce({ clinicId: "c1", vendor, stream, driver, sink: () => void 0 });
    expect(first.emitted).toBe(1);
    const second = await pollOnce({ clinicId: "c1", vendor, stream, driver, sink: () => void 0 });
    expect(second.emitted).toBe(0);
    expect(second.newCursor).toBe(first.newCursor);
    await driver.close();
  });

  // Phase 9: InvoiceRefunded against the real SQLite engine. Proves abs() and
  // the storno predicate actually run in better-sqlite3, the magnitude comes
  // out positive, and an appt-less credit still emits (pvsAppointmentId
  // omitted; the derive worker bridges it via the original invoice id).
  it("emits InvoiceRefunded with a positive magnitude from credit rows", async () => {
    // Add a negative-amount credit (linked to appt 200) and a 'credited' row
    // with a positive amount and no appointment, beside the paid invoice 5000.
    const seed = new BetterSqlite3(dbPath);
    seed.exec(`
      INSERT INTO invoices (id, patient_id, appointment_id, encounter_id, amount_total, paid_at, status, modified_at)
      VALUES
        (5100, 10, 200, NULL, -120.0, NULL, 'refunded', '2026-06-05T09:00:00.000Z'),
        (5101, 10, NULL, NULL, 80.0, NULL, 'credited', '2026-06-06T09:00:00.000Z');
    `);
    seed.close();

    const vendor = await loadVendorConfigFile(PIXEL_YAML);
    const stream = vendor.streams.find((s) => s.kind === "InvoiceRefunded")!;
    const driver = new SqliteDriver();
    await driver.connect({
      host: "",
      port: 0,
      database: dbPath,
      username: "",
      password: "",
    });

    const refunds: CanonicalEventBase[] = [];
    const out = await pollOnce({
      clinicId: "c1",
      vendor,
      stream,
      driver,
      sink: (e) => refunds.push(e),
    });

    expect(out.emitted).toBe(2);
    const byInvoice = new Map(refunds.map((e) => [String(e.pvsInvoiceId), e]));
    expect(byInvoice.get("5100")!.refundedAmountCents).toBe(12000); // abs(-120)
    expect(byInvoice.get("5100")!.pvsAppointmentId).toBe("200");
    expect(byInvoice.get("5101")!.refundedAmountCents).toBe(8000);
    expect(byInvoice.get("5101")!.pvsAppointmentId).toBeUndefined();
    // The paid invoice 5000 stays out of the refund stream.
    expect(refunds.some((e) => String(e.pvsInvoiceId) === "5000")).toBe(false);
    await driver.close();
  });
});
