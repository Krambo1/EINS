import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import {
  _setStateDbForTesting,
  loadState,
  pollOnce,
  saveState,
  _internal,
  recordDrift,
  pendingDriftReports,
  markDriftReported,
} from "./framework.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type {
  CanonicalEventBase,
  DbDriver,
  DbConnectionParams,
  QueryResult,
  VendorConfig,
} from "./types.js";

const CONFIG_YAML = `
vendor: tomedo-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: tomedo-db-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:appointment:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

class StubDriver implements DbDriver {
  readonly engine = "postgres" as const;
  private nextResult: QueryResult = { columns: [], rows: [] };
  private nextError: Error | null = null;
  calls: Array<{ sql: string; params: Record<string, string | number> }> = [];

  setNext(result: QueryResult): void {
    this.nextResult = result;
    this.nextError = null;
  }
  setError(err: Error): void {
    this.nextError = err;
  }
  async connect(_params: DbConnectionParams): Promise<void> {
    return;
  }
  async query(
    sql: string,
    params: Record<string, string | number>
  ): Promise<QueryResult> {
    this.calls.push({ sql, params });
    if (this.nextError) throw this.nextError;
    return this.nextResult;
  }
  async close(): Promise<void> {
    return;
  }
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
}

beforeEach(() => {
  // Fresh in-memory SQLite per test for state isolation.
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
      reported_to_portal INTEGER NOT NULL DEFAULT 0
    );
  `);
  _setStateDbForTesting(handle);
});

async function vendorAndDriver(): Promise<{
  vendor: VendorConfig;
  driver: StubDriver;
}> {
  const vendor = await loadVendorConfigFromString(CONFIG_YAML, "test.yaml");
  return { vendor, driver: new StubDriver() };
}

describe("framework: cursor persistence", () => {
  it("round-trips cursor through saveState / loadState", () => {
    saveState({
      vendorId: "tomedo-db",
      streamKind: "PatientUpserted",
      cursor: "2026-05-20T10:00:00.000Z",
      cursorTiebreak: "4242",
      status: "idle",
      lastRunAt: 12345,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: 6789,
      columnSnapshot: ["id", "modified_at"],
    });
    const state = loadState("tomedo-db", "PatientUpserted");
    expect(state.cursor).toBe("2026-05-20T10:00:00.000Z");
    expect(state.cursorTiebreak).toBe("4242");
    expect(state.columnSnapshot).toEqual(["id", "modified_at"]);
    expect(state.lastRunAt).toBe(12345);
  });

  it("returns default state for unseen (vendor, kind)", () => {
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.cursor).toBe("");
    expect(state.cursorTiebreak).toBe("");
    expect(state.status).toBe("idle");
    expect(state.columnSnapshot).toBeNull();
  });
});

describe("framework: keyset cursor comparison (finding 6)", () => {
  const adv = _internal.cursorAdvances;

  it("advances when the cursor value is strictly greater", () => {
    expect(adv("2026-05-02", "1", "2026-05-01", "999")).toBe(true);
  });

  it("does not advance when the cursor value is strictly smaller", () => {
    expect(adv("2026-05-01", "999", "2026-05-02", "1")).toBe(false);
  });

  it("breaks ties NUMERICALLY, not lexically (id 10 sorts after id 9)", () => {
    // The whole point of the tiebreak: a lexical compare would rank "10" < "9"
    // and strand every id past 9 in a same-timestamp cluster.
    expect(adv("2026-05-01", "10", "2026-05-01", "9")).toBe(true);
    expect(adv("2026-05-01", "9", "2026-05-01", "10")).toBe(false);
  });

  it("does not advance on an exact (cursor, tiebreak) tie", () => {
    expect(adv("2026-05-01", "5", "2026-05-01", "5")).toBe(false);
  });

  it("always advances from an empty starting cursor (first poll)", () => {
    expect(adv("2026-05-01", "1", "", "")).toBe(true);
  });
});

describe("framework: first poll snapshots columns", () => {
  it("captures column names on the very first run", async () => {
    const { vendor, driver } = await vendorAndDriver();
    driver.setNext({
      columns: ["id", "patient_id", "termin_zeit", "modified_at"],
      rows: [
        {
          id: "APPT-1",
          patient_id: "PAT-1",
          termin_zeit: new Date("2026-05-21T14:00:00Z"),
          modified_at: new Date("2026-05-20T10:00:00Z"),
        },
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (event) => collected.push(event),
    });
    expect(outcome.emitted).toBe(1);
    expect(outcome.driftDetected).toBe(false);
    expect(collected[0].pvsExternalEventId).toBe("tomedo:appointment:APPT-1");
    expect(collected[0].kind).toBe("AppointmentCreated");

    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.columnSnapshot).toEqual([
      "id",
      "patient_id",
      "termin_zeit",
      "modified_at",
    ]);
    expect(state.cursor).toBe("2026-05-20T10:00:00.000Z");
  });
});

describe("framework: schema-drift detection", () => {
  it("halts the stream when a column is renamed", async () => {
    const { vendor, driver } = await vendorAndDriver();
    // First poll seeds the snapshot.
    driver.setNext({
      columns: ["id", "patient_id", "termin_zeit", "modified_at"],
      rows: [
        {
          id: "APPT-1",
          patient_id: "PAT-1",
          termin_zeit: "2026-05-21T14:00:00Z",
          modified_at: "2026-05-20T10:00:00Z",
        },
      ],
    });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });

    // Tomedo "renames" termin_zeit → appointment_time. Second poll returns
    // the renamed column.
    driver.setNext({
      columns: ["id", "patient_id", "appointment_time", "modified_at"],
      rows: [
        {
          id: "APPT-2",
          patient_id: "PAT-2",
          appointment_time: "2026-05-22T14:00:00Z",
          modified_at: "2026-05-20T11:00:00Z",
        },
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (event) => collected.push(event),
    });
    expect(outcome.driftDetected).toBe(true);
    expect(outcome.driftReport).not.toBeNull();
    expect(outcome.driftReport!.missing).toContain("termin_zeit");
    expect(outcome.driftReport!.added).toContain("appointment_time");
    expect(outcome.emitted).toBe(0);
    expect(collected).toHaveLength(0);

    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.status).toBe("schema_drift");

    // A subsequent poll attempt is a no-op while the stream is halted.
    driver.setNext({
      columns: ["id", "patient_id", "appointment_time", "modified_at"],
      rows: [],
    });
    const next = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(next.emitted).toBe(0);
    expect(next.driftDetected).toBe(true);
  });

  it("does not detect drift when columns match exactly", async () => {
    const { vendor, driver } = await vendorAndDriver();
    for (let i = 0; i < 3; i++) {
      driver.setNext({
        columns: ["id", "patient_id", "termin_zeit", "modified_at"],
        rows: [],
      });
      const outcome = await pollOnce({
        clinicId: "c1",
        vendor,
        stream: vendor.streams[0],
        driver,
        sink: () => void 0,
      });
      expect(outcome.driftDetected).toBe(false);
    }
  });
});

describe("framework: failure backoff", () => {
  it("increments consecutiveFailures and pushes nextRunAt out", async () => {
    const { vendor, driver } = await vendorAndDriver();
    driver.setError(new Error("connection refused"));
    let now = 1_000_000;
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
      now: () => now,
    });
    expect(outcome.emitted).toBe(0);
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toContain("connection refused");
    expect(state.nextRunAt).toBeGreaterThan(now);
  });

  it("backoff series stays within bounds", () => {
    expect(_internal.backoffMs(1)).toBe(30_000);
    expect(_internal.backoffMs(2)).toBe(60_000);
    expect(_internal.backoffMs(3)).toBe(120_000);
    expect(_internal.backoffMs(10)).toBe(60 * 60_000);
  });
});

describe("framework: query errors classified as schema drift (review finding 2)", () => {
  it("a renamed column that throws is recorded as drift, not a generic failure", async () => {
    const { vendor, driver } = await vendorAndDriver();
    // pg raises SQLSTATE 42703 (undefined_column) when the explicit-column
    // SELECT references a column the vendor renamed. The query throws rather
    // than returning a different shape, so the snapshot detector never sees it.
    const pgErr = Object.assign(
      new Error('column "termin_zeit" does not exist'),
      { code: "42703" }
    );
    driver.setError(pgErr);
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(outcome.driftDetected).toBe(true);
    expect(outcome.driftReport).not.toBeNull();
    expect(outcome.driftReport!.missing).toContain("termin_zeit");

    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.status).toBe("schema_drift");
    // It is surfaced loudly: a pending drift report exists for the publisher.
    expect(pendingDriftReports().length).toBeGreaterThan(0);
  });

  it("a transient connection error is NOT misclassified as drift", async () => {
    const { vendor, driver } = await vendorAndDriver();
    driver.setError(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), {
        code: "ECONNREFUSED",
      })
    );
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(outcome.driftDetected).toBe(false);
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.consecutiveFailures).toBe(1);
    expect(state.status).not.toBe("schema_drift");
  });

  it("isSchemaError recognises each engine's undefined-column signal", () => {
    expect(_internal.isSchemaError({ code: "42703" })).toBe(true); // postgres
    expect(_internal.isSchemaError({ code: "ER_BAD_FIELD_ERROR" })).toBe(true); // mysql
    expect(_internal.isSchemaError({ number: 207 })).toBe(true); // mssql
    expect(_internal.isSchemaError({ errorNum: 904 })).toBe(true); // oracle
    expect(_internal.isSchemaError(new Error("no such column: foo"))).toBe(true); // sqlite
    expect(_internal.isSchemaError(new Error("Column unknown\n  FOO"))).toBe(true); // firebird
    expect(_internal.isSchemaError({ code: "ECONNREFUSED" })).toBe(false);
    expect(_internal.isSchemaError(new Error("connection timeout"))).toBe(false);
    expect(_internal.isSchemaError(null)).toBe(false);
  });
});

describe("framework: drift records", () => {
  it("records and reads pending drift reports", () => {
    recordDrift({
      vendorId: "tomedo-db",
      streamKind: "AppointmentCreated",
      expectedColumns: ["a", "b"],
      observedColumns: ["a", "c"],
      missing: ["b"],
      added: ["c"],
      detectedAt: new Date().toISOString(),
    });
    const pending = pendingDriftReports();
    expect(pending).toHaveLength(1);
    expect(pending[0].missing).toEqual(["b"]);
    markDriftReported(pending[0].id);
    expect(pendingDriftReports()).toHaveLength(0);
  });
});
