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
      status: "idle",
      lastRunAt: 12345,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: 6789,
      columnSnapshot: ["id", "modified_at"],
    });
    const state = loadState("tomedo-db", "PatientUpserted");
    expect(state.cursor).toBe("2026-05-20T10:00:00.000Z");
    expect(state.columnSnapshot).toEqual(["id", "modified_at"]);
    expect(state.lastRunAt).toBe(12345);
  });

  it("returns default state for unseen (vendor, kind)", () => {
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.cursor).toBe("");
    expect(state.status).toBe("idle");
    expect(state.columnSnapshot).toBeNull();
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
