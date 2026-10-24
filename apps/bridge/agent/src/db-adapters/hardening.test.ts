import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _setStateDbForTesting,
  bumpGeneration,
  isStreamDue,
  loadState,
  pollOnce,
  _internal,
  saveState,
} from "./framework.js";
import { SqliteDriver } from "./drivers/sqlite.js";
import { probeSchema } from "./schema-probe.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import { connectBackoffMs, defaultConfigsDir, startRunner, type RunnerHandle } from "./runner.js";
import type {
  CanonicalEventBase,
  DbConnectionParams,
  DbDriver,
  QueryResult,
  StreamConfig,
  VendorConfig,
} from "./types.js";

/**
 * Hardening regressions for the SQL DB-adapter framework: each test reproduces
 * one failure that would otherwise only show up on a real practice database.
 */

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const STATE_DDL = `
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
`;

let tmp: string;
let dbPath: string;
const drivers: DbDriver[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "eins-hardening-"));
  dbPath = join(tmp, "pvs.sqlite");
  const handle = new Database(":memory:");
  handle.exec(STATE_DDL);
  _setStateDbForTesting(handle);
});

afterEach(async () => {
  for (const d of drivers.splice(0)) await d.close().catch(() => void 0);
  _setStateDbForTesting(null);
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Windows may hold the sqlite file briefly; the OS temp dir is cleaned later.
  }
});

const SQLITE_YAML = (extra = "") => `
vendor: hard-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
${extra}
connection:
  credentialId: hard-default
  database: ""
streams:
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
      pvsExternalEventId: { template: "hard:appt:{id}:{modified_at}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

interface Seed {
  id: number;
  modified: string | number;
  termin?: string;
  patient?: number | null;
}

function seedTable(rows: Seed[], modifiedType = "TEXT"): void {
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE IF NOT EXISTS termin (id INTEGER PRIMARY KEY, patient_id INTEGER, termin_zeit TEXT, modified_at ${modifiedType});`
  );
  const ins = db.prepare(
    `INSERT INTO termin (id, patient_id, termin_zeit, modified_at) VALUES (?, ?, ?, ?)`
  );
  for (const r of rows) {
    ins.run(r.id, r.patient === undefined ? 100 + r.id : r.patient, r.termin ?? "2026-06-20 10:00:00", r.modified);
  }
  db.close();
}

async function sqliteSetup(yaml = SQLITE_YAML()): Promise<{
  vendor: VendorConfig;
  stream: StreamConfig;
  driver: SqliteDriver;
}> {
  const vendor = await loadVendorConfigFromString(yaml, "hard.yaml");
  const driver = new SqliteDriver();
  await driver.connect({ host: "", port: 0, database: dbPath, username: "", password: "" });
  drivers.push(driver);
  return { vendor, stream: vendor.streams[0], driver };
}

/** 2026-06-10 10:00:00Z = 12:00 Berlin summer time. */
const NOW = Date.parse("2026-06-10T10:00:00Z");
const MIN = 60_000;

function wallTs(ms: number): string {
  // SQLite 'YYYY-MM-DD HH:MM:SS' text as a PVS writes it (Berlin wall clock).
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function bulk(count: number, startId: number, baseWallMs: number): Seed[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i,
    modified: wallTs(baseWallMs + i * 1000),
  }));
}

/** Berlin wall clock (as naive ms) at NOW: 12:00:00. */
const WALL_NOW = Date.parse("2026-06-10T12:00:00Z");

function poll(
  setup: { vendor: VendorConfig; stream: StreamConfig; driver: DbDriver },
  now: number,
  sink: (e: CanonicalEventBase) => void = () => void 0
) {
  return pollOnce({
    clinicId: "c1",
    vendor: setup.vendor,
    stream: setup.stream,
    driver: setup.driver,
    sink,
    now: () => now,
  });
}

// ---------------------------------------------------------------------------
// P0-1 future sentinel
// ---------------------------------------------------------------------------

describe("P0-1: a future-dated row cannot wedge the cursor", () => {
  it("emits the sentinel row, clamps the cursor, warns, and keeps polling new rows", async () => {
    seedTable([
      ...bulk(11, 1, WALL_NOW - 30 * MIN),
      { id: 12, modified: "2099-12-31 00:00:00" },
    ]);
    const setup = await sqliteSetup();
    const emitted: CanonicalEventBase[] = [];
    const first = await poll(setup, NOW, (e) => emitted.push(e));

    expect(first.emitted).toBe(12);
    expect(first.futureRows).toBe(1);
    const state = loadState("hard-db", "AppointmentCreated");
    expect(Date.parse(state.cursor)).toBeLessThanOrEqual(WALL_NOW + 10 * MIN);
    expect(state.lastError).toContain("1 rows with future modified_at");

    // A genuinely new row arrives later; the sentinel must not hide it.
    seedTable([{ id: 13, modified: wallTs(WALL_NOW + 5 * MIN) }]);
    const later = NOW + 6 * MIN;
    const ids = new Set<string>();
    await poll(setup, later, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(ids.has("13")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P0-2 cursor format
// ---------------------------------------------------------------------------

describe("P0-2: sqlite text timestamps compare in the column's own format", () => {
  it("does not lose same-day rows (space vs T separator)", async () => {
    // Stored as 'YYYY-MM-DD HH:MM:SS'. Binding a Date (ISO 'T' form) would make
    // every same-day value compare LOWER than the cursor ('T' > ' ') and drop it.
    seedTable(bulk(10, 1, WALL_NOW - 120 * MIN));
    const setup = await sqliteSetup();
    const ids = new Set<string>();
    await poll(setup, NOW, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(ids.size).toBe(10);

    // A same-day row, later than the cursor but earlier than "now".
    seedTable([{ id: 50, modified: wallTs(WALL_NOW - 10 * MIN) }]);
    await poll(setup, NOW + MIN, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(ids.has("50")).toBe(true);
  });

  it("halts with config_invalid when the column is not stored in the configured format", async () => {
    // Config says iso_text (default for sqlite) but the column holds epoch integers.
    const epochs = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      modified: Math.floor(NOW / 1000) - i * 60,
    }));
    seedTable(epochs, "INTEGER");
    const setup = await sqliteSetup();
    const out = await poll(setup, NOW);
    expect(out.emitted).toBe(0);
    const state = loadState("hard-db", "AppointmentCreated");
    expect(state.status).toBe("config_invalid");
    expect(state.lastError).toMatch(/cursorFormat|format/i);
  });

  it("works with cursorFormat epoch_s when configured", async () => {
    const epochs = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      // Epoch seconds of the WALL clock labelled as UTC, the same convention a
      // zone-less value has everywhere else in this framework.
      modified: Math.floor((WALL_NOW - 60 * MIN) / 1000) + i,
    }));
    seedTable(epochs, "INTEGER");
    const setup = await sqliteSetup(SQLITE_YAML("cursorFormat: epoch_s"));
    const ids = new Set<string>();
    const out = await poll(setup, NOW, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(out.emitted).toBe(10);
    expect(loadState("hard-db", "AppointmentCreated").status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// P1-3 time zone
// ---------------------------------------------------------------------------

describe("P1-3: zone-less DB timestamps are converted from Berlin wall clock", () => {
  async function emittedFor(termin: string): Promise<string | undefined> {
    seedTable([
      { id: 1, modified: wallTs(WALL_NOW - 5 * MIN), termin },
    ]);
    const setup = await sqliteSetup();
    let at: string | undefined;
    await poll(setup, NOW, (e) => {
      at = e.scheduledAt as string;
    });
    return at;
  }

  it("summer (CEST, UTC+2)", async () => {
    expect(await emittedFor("2026-07-01 10:00:00")).toBe("2026-07-01T08:00:00.000Z");
  });

  it("winter (CET, UTC+1)", async () => {
    expect(await emittedFor("2026-01-15 10:00:00")).toBe("2026-01-15T09:00:00.000Z");
  });

  it("timezone: utc leaves the instant alone", async () => {
    seedTable([{ id: 1, modified: wallTs(WALL_NOW - 5 * MIN), termin: "2026-07-01 10:00:00" }]);
    const setup = await sqliteSetup(SQLITE_YAML("timezone: utc"));
    let at: string | undefined;
    await poll(setup, NOW, (e) => {
      at = e.scheduledAt as string;
    });
    expect(at).toBe("2026-07-01T10:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// P1-4 empty stream + plausibility
// ---------------------------------------------------------------------------

describe("P1-4: an empty stream over a non-empty table is flagged suspect_empty", () => {
  it("runs the COUNT diagnostic after 3 empty polls", async () => {
    // Rows exist but are far older than the first-poll horizon: the query
    // returns nothing, exactly like a wrong status literal would.
    seedTable(bulk(5, 1, Date.parse("2020-01-01T00:00:00Z")));
    const setup = await sqliteSetup();
    for (let i = 0; i < 2; i++) {
      await poll(setup, NOW + i * MIN);
      expect(loadState("hard-db", "AppointmentCreated").status).toBe("idle");
    }
    await poll(setup, NOW + 3 * MIN);
    const state = loadState("hard-db", "AppointmentCreated");
    expect(state.status).toBe("suspect_empty");
    expect(state.lastError).toMatch(/5 Zeilen/);
  });

  it("recovers from suspect_empty when rows show up", async () => {
    seedTable(bulk(5, 1, Date.parse("2020-01-01T00:00:00Z")));
    const setup = await sqliteSetup();
    for (let i = 0; i < 3; i++) await poll(setup, NOW + i * MIN);
    expect(loadState("hard-db", "AppointmentCreated").status).toBe("suspect_empty");
    seedTable(bulk(10, 100, WALL_NOW));
    await poll(setup, NOW + 10 * MIN);
    expect(loadState("hard-db", "AppointmentCreated").status).toBe("idle");
  });
});

describe("P1-4: amount plausibility", () => {
  const INVOICE_YAML = `
vendor: amt-db
driver: sqlite
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: amt-default
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
      pvsExternalEventId: { template: "amt:invoice:{id}" }
      occurredAt: { from: bezahlt_am, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsInvoiceId: id
      pvsAppointmentId: id
      amountCents: { from: betrag, transform: amountToCents }
      currency: { literal: "EUR" }
      paidAt: { from: bezahlt_am, transform: isoDateTime }
`;

  async function invoiceSetup(amounts: number[]) {
    const db = new Database(dbPath);
    db.exec(
      `CREATE TABLE rechnung (id INTEGER PRIMARY KEY, patient_id INTEGER, betrag REAL, bezahlt_am TEXT, modified_at TEXT);`
    );
    const ins = db.prepare(`INSERT INTO rechnung VALUES (?,?,?,?,?)`);
    amounts.forEach((a, i) =>
      ins.run(i + 1, 10 + i, a, "2026-06-09 10:00:00", wallTs(WALL_NOW - (60 - i) * MIN))
    );
    db.close();
    return sqliteSetup(INVOICE_YAML);
  }

  it("emits an invoice over 50,000 EUR but flags it", async () => {
    const setup = await invoiceSetup([100, 120, 90, 60_000]);
    const out = await poll(setup, NOW);
    expect(out.emitted).toBe(4);
    expect(loadState("amt-db", "InvoicePaid").lastError).toMatch(/50[.,]?000/);
  });

  it("flags a median below 1 EUR after 20 rows (cents read as euros)", async () => {
    const setup = await invoiceSetup(Array.from({ length: 24 }, () => 0.5));
    const out = await poll(setup, NOW);
    expect(out.emitted).toBe(24);
    expect(loadState("amt-db", "InvoicePaid").lastError).toMatch(/Median|median/);
  });
});

// ---------------------------------------------------------------------------
// P1-5 first-poll minimum sample, generation guard
// ---------------------------------------------------------------------------

describe("P1-5a: a first-poll verdict needs a real sample", () => {
  it("defers (does not halt) when 3 invalid rows are a fraction of a larger table", async () => {
    const rows: Seed[] = Array.from({ length: 30 }, (_, i) => ({
      id: i + 1,
      modified: wallTs(WALL_NOW - (60 - i) * MIN),
      patient: i < 3 ? null : i,
    }));
    seedTable(rows);
    // batchSize 3 returns only the 3 oldest rows, all without a patient id.
    const setup = await sqliteSetup(SQLITE_YAML().replace("batchSize: 500", "batchSize: 3"));
    const out = await poll(setup, NOW);
    expect(out.emitted).toBe(0);
    const state = loadState("hard-db", "AppointmentCreated");
    expect(state.status).not.toBe("config_invalid");
    expect(state.cursor).toBe("");
    expect(state.lastError).toMatch(/sample too small/);
  });

  it("halts when the same invalid rows are the WHOLE table (COUNT verifies)", async () => {
    seedTable(
      Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        modified: wallTs(WALL_NOW - (10 - i) * MIN),
        patient: null,
      }))
    );
    const setup = await sqliteSetup();
    await poll(setup, NOW);
    expect(loadState("hard-db", "AppointmentCreated").status).toBe("config_invalid");
  });

  it("halts when 10 or more sampled rows are invalid", async () => {
    seedTable(
      Array.from({ length: 12 }, (_, i) => ({
        id: i + 1,
        modified: wallTs(WALL_NOW - (30 - i) * MIN),
        patient: null,
      }))
    );
    const setup = await sqliteSetup();
    await poll(setup, NOW);
    expect(loadState("hard-db", "AppointmentCreated").status).toBe("config_invalid");
  });
});

class ScriptedDriver implements DbDriver {
  readonly engine = "postgres" as const;
  calls = 0;
  handler: (
    n: number,
    params: Record<string, string | number | Date>
  ) => Promise<QueryResult> | QueryResult = () => ({ columns: [], rows: [] });
  async connect(_p: DbConnectionParams): Promise<void> {}
  async query(
    _sql?: string,
    params: Record<string, string | number | Date> = {}
  ): Promise<QueryResult> {
    this.calls += 1;
    return this.handler(this.calls, params);
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
}

const PG_YAML = (batch = 500) => `
vendor: scripted-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: ${batch}
connection:
  credentialId: scripted-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "scr:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;
const COLS = ["id", "patient_id", "termin_zeit", "modified_at"];
function pgRow(id: number, iso: string): Record<string, unknown> {
  return { id: String(id), patient_id: `P${id}`, termin_zeit: new Date(iso), modified_at: new Date(iso) };
}
async function scripted(batch = 500) {
  const vendor = await loadVendorConfigFromString(PG_YAML(batch), "scripted.yaml");
  const driver = new ScriptedDriver();
  return { vendor, stream: vendor.streams[0], driver };
}

describe("P1-5b: a reload invalidates an in-flight poll", () => {
  it("does not write stale state after bumpGeneration", async () => {
    const setup = await scripted();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    setup.driver.handler = async () => {
      await gate;
      return { columns: COLS, rows: [pgRow(1, "2026-06-10T08:00:00Z")] };
    };
    const pending = poll(setup, NOW);
    // Let the poll load its state and block inside the query.
    await new Promise((r) => setTimeout(r, 20));
    // Operator pushes a new config: state is rewritten and the generation bumps.
    bumpGeneration("scripted-db");
    saveState({
      vendorId: "scripted-db",
      streamKind: "AppointmentCreated",
      cursor: "",
      cursorTiebreak: "",
      status: "idle",
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: 0,
      columnSnapshot: null,
    });
    release();
    await pending;
    const state = loadState("scripted-db", "AppointmentCreated");
    expect(state.cursor).toBe("");
    expect(state.columnSnapshot).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// P1-6 halt / re-probe
// ---------------------------------------------------------------------------

describe("P1-6: halted streams are re-probed and recover", () => {
  it("halts after 3 schema errors, stays quiet, then recovers 30 min later", async () => {
    const setup = await scripted();
    const err = Object.assign(new Error('relation "termin" does not exist'), { code: "42P01" });
    setup.driver.handler = () => {
      throw err;
    };
    let t = NOW;
    for (let i = 0; i < _internal.SCHEMA_ERROR_THRESHOLD; i++) {
      await poll(setup, t);
      t += MIN;
    }
    let state = loadState("scripted-db", "AppointmentCreated");
    expect(state.status).toBe("schema_drift");

    // Table name lands in the report's `missing`.
    const { pendingDriftReports } = await import("./framework.js");
    const reports = pendingDriftReports();
    expect(reports.length).toBe(1);
    expect(reports[0].missing).toContain("termin");

    // Not due before the re-probe interval, and not polled either.
    const callsAfterHalt = setup.driver.calls;
    expect(isStreamDue(setup.vendor, setup.stream, state, t + 5 * MIN)).toBe(false);
    await poll(setup, t + 5 * MIN);
    expect(setup.driver.calls).toBe(callsAfterHalt);

    // A failed re-probe stays halted and files no second report.
    const reprobeAt = t + _internal.REPROBE_MS + MIN;
    expect(isStreamDue(setup.vendor, setup.stream, loadState("scripted-db", "AppointmentCreated"), reprobeAt)).toBe(true);
    await poll(setup, reprobeAt);
    expect(loadState("scripted-db", "AppointmentCreated").status).toBe("schema_drift");
    expect(pendingDriftReports().length).toBe(1);

    // The PVS finished its migration: the next re-probe recovers the stream.
    setup.driver.handler = () => ({
      columns: COLS,
      rows: Array.from({ length: 10 }, (_, i) => pgRow(i + 1, "2026-06-10T08:00:00Z")),
    });
    const recoverAt = reprobeAt + _internal.REPROBE_MS + MIN;
    const out = await poll(setup, recoverAt);
    expect(out.recovered).toBe(true);
    expect(out.emitted).toBe(10);
    state = loadState("scripted-db", "AppointmentCreated");
    expect(state.status).toBe("idle");
    expect(state.consecutiveFailures).toBe(0);
  });

  it("a single schema-class error is just a retried failure", async () => {
    const setup = await scripted();
    setup.driver.handler = () => {
      throw Object.assign(new Error("column x does not exist"), { code: "42703" });
    };
    await poll(setup, NOW);
    const state = loadState("scripted-db", "AppointmentCreated");
    expect(state.status).toBe("idle");
    expect(state.lastError).toMatch(/schema error 1\/3/);
    expect(state.nextRunAt).toBeGreaterThan(NOW);
  });
});

// ---------------------------------------------------------------------------
// P1-8 cursor does not advance
// ---------------------------------------------------------------------------

describe("P1-8: a full batch that cannot move the cursor halts loudly", () => {
  it("halts with 'cursor does not advance' instead of re-reading forever", async () => {
    const setup = await scripted(2);
    // A cluster of identical-timestamp rows larger than any limit the framework
    // may raise to (finding 5 retries with :limit x4 up to 5000): every query,
    // whatever its :limit, returns a FULL batch at the very same cursor value.
    setup.driver.handler = (_n, params) => ({
      columns: COLS,
      rows: Array.from({ length: Number(params.limit) }, (_, i) =>
        pgRow(i + 1, "2026-06-10T08:00:00Z")
      ),
    });
    const first = await poll(setup, NOW);
    expect(first.emitted).toBe(2);
    // The second poll is mid-drain (previous batch was full) and returns the very
    // same two rows at the very same cursor value: nothing moved.
    await poll(setup, NOW + MIN);
    const state = loadState("scripted-db", "AppointmentCreated");
    expect(state.status).toBe("config_invalid");
    expect(state.lastError).toContain("cursor does not advance");
  });

  it("an escaping throw goes through backoff (recordFailure), not a hot loop", async () => {
    const setup = await scripted();
    setup.driver.handler = () => ({
      columns: COLS,
      // Poisoned cursor value that throws when stringified.
      rows: Array.from({ length: 10 }, (_, i) => ({
        ...pgRow(i + 1, "2026-06-10T08:00:00Z"),
        modified_at: {
          toString() {
            throw new Error("boom");
          },
        },
      })),
    });
    const out = await poll(setup, NOW);
    expect(out.emitted).toBe(0);
    const state = loadState("scripted-db", "AppointmentCreated");
    expect(state.nextRunAt).toBeGreaterThan(NOW - 1);
  });
});

// ---------------------------------------------------------------------------
// P1-9 connect backoff and auth stop
// ---------------------------------------------------------------------------

class ConnectDriver implements DbDriver {
  readonly engine = "postgres" as const;
  static attempts = 0;
  static behaviour: "refuse" | "auth" | "ok" = "refuse";
  async connect(_p: DbConnectionParams): Promise<void> {
    ConnectDriver.attempts += 1;
    if (ConnectDriver.behaviour === "refuse") {
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });
    }
    if (ConnectDriver.behaviour === "auth") {
      throw Object.assign(new Error('password authentication failed for user "eins"'), { code: "28P01" });
    }
  }
  async query(): Promise<QueryResult> {
    return { columns: [], rows: [] };
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
}

describe("P1-9: connect backoff and auth stop", () => {
  let handle: RunnerHandle | null = null;
  afterEach(async () => {
    if (handle) await handle.stop();
    handle = null;
  });

  it("connectBackoffMs doubles from 10 s up to 30 min", () => {
    expect(connectBackoffMs(1)).toBe(10_000);
    expect(connectBackoffMs(2)).toBe(20_000);
    expect(connectBackoffMs(3)).toBe(40_000);
    expect(connectBackoffMs(30)).toBe(30 * 60_000);
  });

  async function runner(password: { value: string }, clock: { t: number }) {
    return startRunner({
      clinicId: "11111111-1111-1111-1111-111111111111",
      enabledVendors: ["tomedo-db"],
      connections: { "tomedo-db": { host: "h", username: "u" } },
      driverFactory: () => new ConnectDriver(),
      credentialLoader: async () => password.value,
      tickMs: 3_600_000,
      now: () => clock.t,
      remoteConfigs: new Map(),
      configsDir: defaultConfigsDir(),
    });
  }

  it("retries a refused connection on an exponential schedule", async () => {
    ConnectDriver.attempts = 0;
    ConnectDriver.behaviour = "refuse";
    const clock = { t: NOW };
    handle = await runner({ value: "pw" }, clock);
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(1);
    clock.t += 5_000;
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(1); // still inside the 10 s backoff
    clock.t += 6_000;
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(2);
    clock.t += 15_000;
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(2); // second backoff is 20 s
    clock.t += 6_000;
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(3);
  });

  it("stops on an auth error, reports auth_failed, and resumes after the credential changes", async () => {
    ConnectDriver.attempts = 0;
    ConnectDriver.behaviour = "auth";
    const clock = { t: NOW };
    const password = { value: "old-secret" };
    handle = await runner(password, clock);
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(1);
    const status = handle.statusSnapshot();
    expect(status.length).toBeGreaterThan(0);
    expect(status.every((s) => s.status === "auth_failed")).toBe(true);

    // Hours pass: not a single further connect attempt (lock-out protection).
    for (let i = 0; i < 5; i++) {
      clock.t += 60 * MIN;
      await handle.tickOnce();
    }
    expect(ConnectDriver.attempts).toBe(1);

    // Operator rotates the credential; the database accepts it.
    ConnectDriver.behaviour = "ok";
    password.value = "new-secret";
    clock.t += 60_000;
    await handle.tickOnce();
    expect(ConnectDriver.attempts).toBe(2);
    expect(handle.statusSnapshot().some((s) => s.status === "auth_failed")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-11 initial horizon, P1-12 lookback
// ---------------------------------------------------------------------------

describe("P1-11: the first poll reads a bounded horizon", () => {
  it("does not read rows older than initialHorizonDays", async () => {
    seedTable([
      { id: 1, modified: "2024-01-01 08:00:00" }, // far outside 90 days
      ...bulk(10, 2, WALL_NOW - 3 * 24 * 60 * MIN),
    ]);
    const setup = await sqliteSetup();
    const ids = new Set<string>();
    await poll(setup, NOW, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(ids.has("1")).toBe(false);
    expect(ids.size).toBe(10);
  });

  it("initialHorizonDays: 0 reads the whole history", async () => {
    seedTable([
      { id: 1, modified: "2024-01-01 08:00:00" },
      ...bulk(10, 2, WALL_NOW - 3 * 24 * 60 * MIN),
    ]);
    const setup = await sqliteSetup(SQLITE_YAML("initialHorizonDays: 0"));
    const ids = new Set<string>();
    await poll(setup, NOW, (e) => ids.add(String(e.pvsAppointmentId)));
    expect(ids.has("1")).toBe(true);
  });
});

describe("P1-12: the lookback re-reads late commits and event ids dedup", () => {
  it("re-emits the same ids for a row version and catches a late-committed row", async () => {
    seedTable(bulk(10, 1, WALL_NOW - 60 * MIN));
    const setup = await sqliteSetup();
    const keys: string[] = [];
    await poll(setup, NOW, (e) => keys.push(`${e.pvsExternalEventId}|${e.occurredAt}`));
    const firstCount = keys.length;
    expect(firstCount).toBe(10);

    // A row that committed late with a timestamp BEFORE the cursor (a long
    // transaction on the PVS side).
    seedTable([{ id: 77, modified: wallTs(WALL_NOW - 61 * MIN + 5000) }]);
    await poll(setup, NOW + 2 * MIN, (e) => keys.push(`${e.pvsExternalEventId}|${e.occurredAt}`));

    // The overlap re-emitted earlier rows with byte-identical keys (so the
    // outbox UNIQUE index collapses them) and also delivered the late row.
    const distinct = new Set(keys);
    expect(distinct.size).toBe(11);
    expect(keys.length).toBeGreaterThan(distinct.size);
    expect([...distinct].some((k) => k.startsWith("hard:appt:77:"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P1-10 schema probe
// ---------------------------------------------------------------------------

describe("P1-10: probeSchema", () => {
  it("lists tables/columns on SQLite and diffs them against the YAML", async () => {
    seedTable(bulk(3, 1, WALL_NOW));
    const vendor = await loadVendorConfigFromString(
      SQLITE_YAML().replace("FROM termin", "FROM termin JOIN praxis_raum ON 1=1"),
      "hard.yaml"
    );
    const driver = new SqliteDriver();
    await driver.connect({ host: "", port: 0, database: dbPath, username: "", password: "" });
    drivers.push(driver);

    const result = await probeSchema(driver, vendor);
    const termin = result.tables.find((t) => t.name.toLowerCase() === "termin");
    expect(termin).toBeDefined();
    expect(termin!.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "patient_id", "termin_zeit", "modified_at"])
    );
    expect(termin!.rowCount).toBe(3);
    expect(result.missingTables.map((t) => t.toLowerCase())).toContain("praxis_raum");
  });

  it("reports a clean diff when everything referenced exists", async () => {
    seedTable(bulk(3, 1, WALL_NOW));
    const vendor = await loadVendorConfigFromString(SQLITE_YAML(), "hard.yaml");
    const driver = new SqliteDriver();
    await driver.connect({ host: "", port: 0, database: dbPath, username: "", password: "" });
    drivers.push(driver);
    const result = await probeSchema(driver, vendor);
    expect(result.missingTables).toEqual([]);
    expect(result.missingColumns).toEqual([]);
  });
});
