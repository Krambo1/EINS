import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setStateDbForTesting, loadState, pollOnce } from "./framework.js";
import { SqliteDriver } from "./drivers/sqlite.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import { freshStateDb } from "./review-support.js";
import type {
  CanonicalEventBase,
  DbDriver,
  QueryResult,
  StreamConfig,
  VendorConfig,
} from "./types.js";

/**
 * Regressions for the verified review findings 2, 4, 5, 6, 7, 10, 11 (framework
 * level). Each test reproduces the failure on a real SQLite file through
 * pollOnce, the same path the runner uses.
 */

let tmp: string;
let dbPath: string;
const drivers: DbDriver[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eins-review-"));
  dbPath = join(tmp, "pvs.sqlite");
  freshStateDb();
});
afterEach(async () => {
  for (const d of drivers.splice(0)) await d.close().catch(() => void 0);
  _setStateDbForTesting(null);
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Windows may hold the file briefly.
  }
});

const MIN = 60_000;
/** 2026-06-10 10:00:00Z = 12:00 Berlin summer time. */
const NOW = Date.parse("2026-06-10T10:00:00Z");
const WALL_NOW = Date.parse("2026-06-10T12:00:00Z");
const wallTs = (ms: number): string =>
  new Date(ms).toISOString().slice(0, 19).replace("T", " ");

async function setup(yaml: string): Promise<{ vendor: VendorConfig; driver: SqliteDriver }> {
  const vendor = await loadVendorConfigFromString(yaml, "review.yaml");
  const driver = new SqliteDriver();
  await driver.connect({ host: "", port: 0, database: dbPath, username: "", password: "" });
  drivers.push(driver);
  return { vendor, driver };
}

function run(
  s: { vendor: VendorConfig; driver: DbDriver },
  stream: StreamConfig,
  now: number,
  sink: (e: CanonicalEventBase) => void = () => void 0
) {
  return pollOnce({ clinicId: "c1", vendor: s.vendor, stream, driver: s.driver, sink, now: () => now });
}

/** Stand-in for the outbox UNIQUE(content_hash) dedup. */
class FakeOutbox {
  readonly rows = new Map<string, CanonicalEventBase>();
  sink = (e: CanonicalEventBase): void => {
    if (!this.rows.has(e.pvsExternalEventId)) this.rows.set(e.pvsExternalEventId, e);
  };
}

// ---------------------------------------------------------------------------
// Finding 4: a changed row version must not be swallowed by the outbox dedup
// ---------------------------------------------------------------------------

const INVOICE_YAML = `
vendor: inv-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: inv-default
  database: ""
streams:
  - kind: InvoicePaid
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    query: |
      SELECT CAST(rechnung.id AS TEXT) AS id, patient_id, betrag, bezahlt_am, modified_at
      FROM rechnung
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND rechnung.id > :cursorTiebreak))
      ORDER BY modified_at ASC, rechnung.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "inv:invoice:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      pvsAppointmentId: id
      amountCents: { from: betrag, transform: amountToCents }
      currency: { literal: "EUR" }
      paidAt: { from: bezahlt_am, transform: isoDateTime }
`;

describe("finding 4: event id changes when the row's content changes", () => {
  it("a corrected amount produces a second distinct event; an unchanged re-read does not", async () => {
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE rechnung (id INTEGER PRIMARY KEY, patient_id INTEGER, betrag REAL, bezahlt_am TEXT, modified_at TEXT);`
    );
    db.prepare(`INSERT INTO rechnung VALUES (1, 10, 450.0, '2026-06-09 10:00:00', ?)`).run(
      wallTs(WALL_NOW - 60 * MIN)
    );
    const s = await setup(INVOICE_YAML);
    const stream = s.vendor.streams[0];
    const outbox = new FakeOutbox();

    await run(s, stream, NOW, outbox.sink);
    expect(outbox.rows.size).toBe(1);
    expect([...outbox.rows.values()][0].amountCents).toBe(45000);

    // Unchanged re-read inside the lookback window: still deduped.
    await run(s, stream, NOW + 2 * MIN, outbox.sink);
    expect(outbox.rows.size).toBe(1);

    // The PVS corrects the amount and bumps modified_at.
    db.prepare(`UPDATE rechnung SET betrag = 540.0, modified_at = ? WHERE id = 1`).run(
      wallTs(WALL_NOW - 5 * MIN)
    );
    db.close();
    await run(s, stream, NOW + 4 * MIN, outbox.sink);
    expect(outbox.rows.size).toBe(2);
    const amounts = [...outbox.rows.values()].map((e) => e.amountCents).sort();
    expect(amounts).toEqual([45000, 54000]);

    // And the corrected version re-read again is still a no-op.
    await run(s, stream, NOW + 6 * MIN, outbox.sink);
    expect(outbox.rows.size).toBe(2);
    for (const id of outbox.rows.keys()) expect(id.length).toBeLessThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// Shared sqlite fixtures
// ---------------------------------------------------------------------------

const APPT_YAML = (extra = "", batch = 500) => `
vendor: rev-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: ${batch}
connection:
  credentialId: rev-default
  database: ""
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
${extra}
    query: |
      SELECT CAST(termin.id AS TEXT) AS id, patient_id, termin_zeit, modified_at
      FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND termin.id > :cursorTiebreak))
      ORDER BY modified_at ASC, termin.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "rev:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

function seedAppts(rows: Array<{ id: number; modified: string }>): void {
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS termin (id INTEGER PRIMARY KEY, patient_id INTEGER, termin_zeit TEXT, modified_at TEXT);`
  );
  const ins = db.prepare(`INSERT INTO termin VALUES (?, ?, '2026-06-20 10:00:00', ?)`);
  const tx = db.transaction(() => {
    for (const r of rows) ins.run(r.id, 100 + r.id, r.modified);
  });
  tx();
  db.close();
}

// ---------------------------------------------------------------------------
// Finding 10: the lookback overlap must be paged to the end of the window
// ---------------------------------------------------------------------------

describe("finding 10: overlap re-read pages through the whole window", () => {
  it("re-checks rows beyond the first batchSize page of the window", async () => {
    const base = WALL_NOW - 25 * MIN;
    seedAppts(
      Array.from({ length: 600 }, (_, i) => ({ id: i + 1, modified: wallTs(base + i * 1000) }))
    );
    const s = await setup(APPT_YAML("", 500));
    const stream = s.vendor.streams[0];
    const seen = new Set<string>();
    const sink = (e: CanonicalEventBase): void => void seen.add(String(e.pvsAppointmentId));

    await run(s, stream, NOW, sink); // 500 (full)
    await run(s, stream, NOW + 1000, sink); // 100 (short): caught up
    expect(seen.size).toBe(600);

    // A transaction that stamped modified_at ~550 s into the window commits late.
    seedAppts([{ id: 9999, modified: wallTs(base + 549 * 1000) }]);
    await run(s, stream, NOW + 2000, sink);
    expect(seen.has("9999")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Finding 5: a cluster sharing one truncated cursor value must not halt
// ---------------------------------------------------------------------------

describe("finding 5: truncated sub-millisecond cluster", () => {
  it("emits all 250 rows sharing one timestamp at X.456 ms with batchSize 100 and does not halt", async () => {
    const X = NOW - 20 * MIN;
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE termin (id INTEGER PRIMARY KEY, patient_id INTEGER, termin_zeit TEXT, modified_ms REAL);`
    );
    const ins = db.prepare(`INSERT INTO termin VALUES (?, ?, '2026-06-20 10:00:00', ?)`);
    db.transaction(() => {
      for (let i = 1; i <= 250; i++) ins.run(i, 100 + i, X + 0.456);
    })();
    db.close();
    const yaml = `
vendor: clus-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 100
connection:
  credentialId: clus-default
  database: ""
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_ms
    cursorType: timestamp
    cursorFormat: epoch_ms
    timezone: utc
    tiebreakColumn: id
    query: |
      SELECT CAST(termin.id AS TEXT) AS id, patient_id, termin_zeit, modified_ms
      FROM termin
      WHERE (modified_ms > :cursor OR (modified_ms = :cursor AND termin.id > :cursorTiebreak))
      ORDER BY modified_ms ASC, termin.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "clus:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;
    const s = await setup(yaml);
    const stream = s.vendor.streams[0];
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      await run(s, stream, NOW + i * 1000, (e) => void seen.add(String(e.pvsAppointmentId)));
    }
    const state = loadState("clus-db", "AppointmentCreated");
    expect(state.status).not.toBe("config_invalid");
    expect(seen.size).toBe(250);
  });
});

// ---------------------------------------------------------------------------
// Finding 6: a stream that went silent while its siblings deliver
// ---------------------------------------------------------------------------

describe("finding 6: silent stream next to a delivering sibling", () => {
  const TWO_STREAM_YAML = `
vendor: sil-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: sil-default
  database: ""
streams:
  - kind: InvoicePaid
    statusColumn: status
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    query: |
      SELECT CAST(rechnung.id AS TEXT) AS id, patient_id, betrag, bezahlt_am, status, modified_at
      FROM rechnung
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND rechnung.id > :cursorTiebreak))
        AND status = 'bezahlt'
      ORDER BY modified_at ASC, rechnung.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "sil:invoice:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      pvsAppointmentId: id
      amountCents: { from: betrag, transform: amountToCents }
      paidAt: { from: bezahlt_am, transform: isoDateTime }
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    query: |
      SELECT CAST(termin.id AS TEXT) AS id, patient_id, termin_zeit, modified_at
      FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND termin.id > :cursorTiebreak))
      ORDER BY modified_at ASC, termin.id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "sil:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;
  const DAY = 86_400_000;

  function seedBoth(): Database.Database {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE rechnung (id INTEGER PRIMARY KEY, patient_id INTEGER, betrag REAL, bezahlt_am TEXT, status TEXT, modified_at TEXT);
      CREATE TABLE termin (id INTEGER PRIMARY KEY, patient_id INTEGER, termin_zeit TEXT, modified_at TEXT);
    `);
    db.prepare(
      `INSERT INTO rechnung VALUES (1, 10, 100.0, '2026-06-09 10:00:00', 'bezahlt', ?)`
    ).run(wallTs(WALL_NOW - 60 * MIN));
    db.prepare(`INSERT INTO termin VALUES (1, 10, '2026-06-20 10:00:00', ?)`).run(
      wallTs(WALL_NOW - 60 * MIN)
    );
    return db;
  }

  it("reports suspect_empty for the invoice stream after 7 days of silence while appointments still arrive", async () => {
    const db = seedBoth();
    const s = await setup(TWO_STREAM_YAML);
    const [inv, appt] = s.vendor.streams;

    await run(s, inv, NOW);
    await run(s, appt, NOW);
    expect(loadState("sil-db", "InvoicePaid").status).toBe("idle");

    // A PVS update renames the paid status ('bezahlt' -> 'B'): the invoice
    // query silently matches nothing from now on, appointments keep flowing.
    db.prepare(`UPDATE rechnung SET status = 'B'`).run();
    const tick = async (d: number): Promise<void> => {
      db.prepare(`INSERT INTO termin VALUES (?, 10, '2026-06-20 10:00:00', ?)`).run(
        100 + d,
        wallTs(WALL_NOW + d * DAY - 5 * MIN)
      );
      await run(s, appt, NOW + d * DAY);
      await run(s, inv, NOW + d * DAY);
    };
    for (let day = 1; day <= 6; day++) await tick(day);
    expect(loadState("sil-db", "InvoicePaid").status).toBe("idle"); // < 7 days

    await tick(8);
    const state = loadState("sil-db", "InvoicePaid");
    expect(state.status).toBe("suspect_empty");
    expect(state.lastError).toMatch(/silent|still|Tage/i);
    expect(loadState("sil-db", "AppointmentCreated").status).toBe("idle");
    db.close();
  });

  it("stays idle when the whole vendor is quiet (no sibling delivers)", async () => {
    seedBoth().close();
    const s = await setup(TWO_STREAM_YAML);
    const [inv, appt] = s.vendor.streams;
    await run(s, inv, NOW);
    await run(s, appt, NOW);
    await run(s, appt, NOW + 8 * DAY);
    await run(s, inv, NOW + 8 * DAY);
    expect(loadState("sil-db", "InvoicePaid").status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Finding 2: cursorSqlType reaches the driver
// ---------------------------------------------------------------------------

describe("finding 2: framework forwards cursorSqlType to the driver", () => {
  class RecordingDriver implements DbDriver {
    readonly engine = "mssql" as const;
    readonly calls: Array<{ options: unknown }> = [];
    async connect(): Promise<void> {}
    async query(
      _sql: string,
      _params: Record<string, string | number | Date>,
      options?: unknown
    ): Promise<QueryResult> {
      this.calls.push({ options });
      return { columns: [], rows: [] };
    }
    async close(): Promise<void> {}
    async healthCheck(): Promise<{ ok: true }> {
      return { ok: true };
    }
  }
  const YAML = (extra: string) => `
vendor: ms-db
driver: mssql
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: ms-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
${extra}
    query: |
      SELECT TOP (:limit) CAST(id AS VARCHAR(20)) AS id, patient_id, termin_zeit, modified_at
      FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND id > :cursorTiebreak))
      ORDER BY modified_at ASC, id ASC
    map:
      pvsExternalEventId: { template: "ms:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;
  it("passes { cursorSqlType: 'datetime2' } only when the stream declares it", async () => {
    const withType = await loadVendorConfigFromString(YAML("    cursorSqlType: datetime2"), "ms.yaml");
    const d1 = new RecordingDriver();
    await pollOnce({ clinicId: "c", vendor: withType, stream: withType.streams[0], driver: d1, now: () => NOW });
    expect(d1.calls[0].options).toEqual({ cursorSqlType: "datetime2" });

    const without = await loadVendorConfigFromString(YAML(""), "ms.yaml");
    const d2 = new RecordingDriver();
    await pollOnce({ clinicId: "c", vendor: without, stream: without.streams[0], driver: d2, now: () => NOW });
    expect(d2.calls[0].options).toBeUndefined();
  });
});
