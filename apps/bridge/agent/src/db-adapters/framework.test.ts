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
  calls: Array<{ sql: string; params: Record<string, string | number | Date> }> = [];

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
    params: Record<string, string | number | Date>
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
      reported_to_portal INTEGER NOT NULL DEFAULT 0,
      report_kind TEXT NOT NULL DEFAULT 'schema_drift',
      detail TEXT
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
    expect(adv("2026-05-02", "1", "2026-05-01", "999", "timestamp")).toBe(true);
  });

  it("does not advance when the cursor value is strictly smaller", () => {
    expect(adv("2026-05-01", "999", "2026-05-02", "1", "timestamp")).toBe(false);
  });

  it("breaks ties NUMERICALLY, not lexically (id 10 sorts after id 9)", () => {
    // The whole point of the tiebreak: a lexical compare would rank "10" < "9"
    // and strand every id past 9 in a same-timestamp cluster.
    expect(adv("2026-05-01", "10", "2026-05-01", "9", "timestamp")).toBe(true);
    expect(adv("2026-05-01", "9", "2026-05-01", "10", "timestamp")).toBe(false);
  });

  it("does not advance on an exact (cursor, tiebreak) tie", () => {
    expect(adv("2026-05-01", "5", "2026-05-01", "5", "timestamp")).toBe(false);
  });

  it("always advances from an empty starting cursor (first poll)", () => {
    expect(adv("2026-05-01", "1", "", "", "timestamp")).toBe(true);
  });
});

describe("framework: integer cursor comparison (Phase 10)", () => {
  const adv = _internal.cursorAdvances;
  const cmp = _internal.compareCursor;

  it("compares integer cursors NUMERICALLY, not lexically", () => {
    // The latent bug: "10" < "9" lexically, so a lexical compare would refuse
    // to advance past 9 and stall the stream at the first power-of-ten boundary.
    expect(cmp("10", "9", "integer")).toBeGreaterThan(0);
    expect(cmp("9", "10", "integer")).toBeLessThan(0);
    expect(cmp("100", "99", "integer")).toBeGreaterThan(0);
    expect(cmp("5", "5", "integer")).toBe(0);
  });

  it("still compares timestamp / string cursors lexically", () => {
    expect(cmp("2026-05-02", "2026-05-01", "timestamp")).toBeGreaterThan(0);
    expect(cmp("b", "a", "string")).toBeGreaterThan(0);
  });

  it("cursorAdvances treats an integer cursor crossing 9 -> 10 as forward", () => {
    // Same cluster shape as the keyset test above, but on an integer cursor
    // column with no tiebreak collision: id 10 must advance past max 9.
    expect(adv("10", "", "9", "", "integer")).toBe(true);
    expect(adv("9", "", "10", "", "integer")).toBe(false);
  });

  it("integer cursor advances from an empty starting cursor (first poll)", () => {
    expect(adv("1", "", "", "", "integer")).toBe(true);
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

  // A poll returning no rows AND no column metadata must never be read as
  // "every column vanished". Some drivers omit field metadata for a zero-row
  // result (node-firebird did exactly this before the Phase 6 driver fix), and
  // a no-new-rows poll is the common steady state. Misreading it as drift would
  // permanently halt a healthy revenue stream.
  it("does not raise drift when a later poll returns no column metadata", async () => {
    const { vendor, driver } = await vendorAndDriver();
    // First poll baselines the snapshot from real data.
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

    // Empty result: zero rows, zero columns. No drift, stream stays healthy,
    // and the baseline snapshot is preserved for the next non-empty poll.
    driver.setNext({ columns: [], rows: [] });
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(outcome.driftDetected).toBe(false);
    expect(outcome.emitted).toBe(0);
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.status).toBe("idle");
    expect(state.columnSnapshot).toEqual([
      "id",
      "patient_id",
      "termin_zeit",
      "modified_at",
    ]);
  });

  it("does not baseline an empty column list on the first poll", async () => {
    const { vendor, driver } = await vendorAndDriver();
    driver.setNext({ columns: [], rows: [] });
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(outcome.driftDetected).toBe(false);
    const state = loadState("tomedo-db", "AppointmentCreated");
    // Snapshot stays null so the first poll WITH column info establishes it,
    // instead of locking in an empty baseline that every real poll then "drifts"
    // from.
    expect(state.columnSnapshot).toBeNull();
    expect(state.status).toBe("idle");
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

// Config whose AppointmentStatusChanged stream maps newStatus through the
// appointmentStatus transform. A status code the transform doesn't recognise
// makes newStatus undefined — the silent corruption Phase 5 catches.
const STATUS_CONFIG_YAML = `
vendor: medatixx
driver: postgres
bridgeSource: gdt_agent
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: medatixx-default
streams:
  - kind: AppointmentStatusChanged
    cursorColumn: modified_at
    cursorType: timestamp
    query: |
      SELECT id, patient_id, status, modified_at FROM termin
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "medatixx:status:{id}" }
      occurredAt: { from: modified_at, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      newStatus: { from: status, transform: appointmentStatus }
`;

async function statusVendorAndDriver(): Promise<{
  vendor: VendorConfig;
  driver: StubDriver;
}> {
  const vendor = await loadVendorConfigFromString(STATUS_CONFIG_YAML, "medatixx.yaml");
  return { vendor, driver: new StubDriver() };
}

function statusRow(id: string, status: string): Record<string, unknown> {
  return {
    id,
    patient_id: `PAT-${id}`,
    status,
    modified_at: new Date("2026-05-20T10:00:00Z"),
  };
}

describe("framework: first-poll value validation (Phase 5)", () => {
  it("halts the stream as config_invalid when the status column holds unmapped codes", async () => {
    const { vendor, driver } = await statusVendorAndDriver();
    // Every row carries a paid/status code the appointmentStatus transform
    // doesn't recognise, so newStatus (a required field) never resolves.
    driver.setNext({
      columns: ["id", "patient_id", "status", "modified_at"],
      rows: [
        statusRow("1", "FANTASIE"),
        statusRow("2", "Z99"),
        statusRow("3", "irgendwas"),
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

    // Nothing emitted; the config was NOT baselined.
    expect(outcome.emitted).toBe(0);
    expect(collected).toHaveLength(0);
    expect(outcome.driftDetected).toBe(false);

    const state = loadState("medatixx", "AppointmentStatusChanged");
    expect(state.status).toBe("config_invalid");
    // columnSnapshot stays null: a halted config re-validates, never silently
    // starts emitting.
    expect(state.columnSnapshot).toBeNull();

    // A config_invalid report is queued for the publisher, naming the field
    // and carrying sample raw values.
    const pending = pendingDriftReports();
    expect(pending).toHaveLength(1);
    expect(pending[0].reportKind).toBe("config_invalid");
    expect(pending[0].configInvalidDetail).not.toBeNull();
    const issues = pending[0].configInvalidDetail!.issues;
    expect(issues.map((i) => i.field)).toContain("newStatus");
    const newStatusIssue = issues.find((i) => i.field === "newStatus")!;
    expect(newStatusIssue.sampleRawValues).toContain("FANTASIE");
    expect(pending[0].configInvalidDetail!.passingRows).toBe(0);
    expect(pending[0].configInvalidDetail!.sampleSize).toBe(3);
  });

  it("a subsequent poll is a no-op while the stream is config_invalid", async () => {
    const { vendor, driver } = await statusVendorAndDriver();
    driver.setNext({
      columns: ["id", "patient_id", "status", "modified_at"],
      rows: [statusRow("1", "FANTASIE")],
    });
    await pollOnce({ clinicId: "c1", vendor, stream: vendor.streams[0], driver, sink: () => void 0 });
    expect(loadState("medatixx", "AppointmentStatusChanged").status).toBe("config_invalid");

    // Even if the data were now valid, the halted stream must not re-poll.
    driver.setNext({
      columns: ["id", "patient_id", "status", "modified_at"],
      rows: [statusRow("2", "geplant")],
    });
    const next = await pollOnce({ clinicId: "c1", vendor, stream: vendor.streams[0], driver, sink: () => void 0 });
    expect(next.emitted).toBe(0);
    expect(next.driftDetected).toBe(false);
  });

  it("baselines a healthy config (status codes the transform recognises)", async () => {
    const { vendor, driver } = await statusVendorAndDriver();
    driver.setNext({
      columns: ["id", "patient_id", "status", "modified_at"],
      rows: [
        statusRow("1", "geplant"),
        statusRow("2", "abgeschlossen"),
        statusRow("3", "storniert"),
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
    expect(outcome.emitted).toBe(3);
    expect(collected).toHaveLength(3);
    const state = loadState("medatixx", "AppointmentStatusChanged");
    expect(state.status).toBe("idle");
    expect(state.columnSnapshot).toEqual(["id", "patient_id", "status", "modified_at"]);
    expect(pendingDriftReports()).toHaveLength(0);
  });

  it("accepts an empty first poll (nothing to validate, table just empty now)", async () => {
    const { vendor, driver } = await statusVendorAndDriver();
    driver.setNext({ columns: ["id", "patient_id", "status", "modified_at"], rows: [] });
    const outcome = await pollOnce({ clinicId: "c1", vendor, stream: vendor.streams[0], driver, sink: () => void 0 });
    expect(outcome.emitted).toBe(0);
    const state = loadState("medatixx", "AppointmentStatusChanged");
    expect(state.status).toBe("idle");
    expect(state.columnSnapshot).toEqual(["id", "patient_id", "status", "modified_at"]);
    expect(pendingDriftReports()).toHaveLength(0);
  });

  it("validateFirstPoll honours the pass-fraction threshold at the boundary", async () => {
    const { vendor } = await statusVendorAndDriver();
    const stream = vendor.streams[0];
    const ctx = { clinicId: "c1", vendor, stream };

    // 4 good + 1 bad of 5 = 0.8 pass rate -> exactly meets the threshold -> ok.
    const atThreshold = _internal.validateFirstPoll(
      [
        statusRow("1", "geplant"),
        statusRow("2", "geplant"),
        statusRow("3", "geplant"),
        statusRow("4", "geplant"),
        statusRow("5", "FANTASIE"),
      ],
      ctx
    );
    expect(atThreshold.passingRows).toBe(4);
    expect(atThreshold.ok).toBe(true);

    // 3 good + 2 bad of 5 = 0.6 < 0.8 -> below threshold -> not ok.
    const belowThreshold = _internal.validateFirstPoll(
      [
        statusRow("1", "geplant"),
        statusRow("2", "geplant"),
        statusRow("3", "geplant"),
        statusRow("4", "FANTASIE"),
        statusRow("5", "Z99"),
      ],
      ctx
    );
    expect(belowThreshold.passingRows).toBe(3);
    expect(belowThreshold.ok).toBe(false);
    expect(belowThreshold.issues[0].field).toBe("newStatus");
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
