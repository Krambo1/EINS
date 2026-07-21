import { describe, it, expect, beforeEach, vi } from "vitest";
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
  withDeadline,
  DeadlineExceededError,
} from "./framework.js";
import { loadVendorConfigFromString } from "./vendor-config.js";
import type {
  CanonicalEventBase,
  DbDriver,
  DbConnectionParams,
  QueryResult,
  StreamConfig,
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

describe("framework: query deadline (reliability review C4)", () => {
  it("withDeadline rejects with DeadlineExceededError when fn never settles", async () => {
    vi.useFakeTimers();
    try {
      const p = withDeadline("test call", 1_000, () => new Promise<never>(() => void 0));
      const assertion = expect(p).rejects.toBeInstanceOf(DeadlineExceededError);
      await vi.advanceTimersByTimeAsync(1_001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("withDeadline passes the value through when fn settles in time", async () => {
    await expect(withDeadline("t", 1_000, async () => 42)).resolves.toBe(42);
  });

  it("a hung driver.query records a backoff failure and discards the connection", async () => {
    vi.useFakeTimers();
    try {
      const { vendor, driver } = await vendorAndDriver();
      let closed = false;
      // A query that never settles: the DB-lock / half-dead-TCP shape that
      // used to wedge the entire tick loop forever.
      driver.query = () => new Promise<never>(() => void 0);
      driver.close = async () => {
        closed = true;
      };
      const stream = vendor.streams[0];
      const p = pollOnce({ clinicId: "clinic-1", vendor, stream, driver });
      await vi.advanceTimersByTimeAsync(150_001);
      const outcome = await p;
      expect(outcome.emitted).toBe(0);
      const state = loadState(vendor.vendor, stream.kind);
      expect(state.consecutiveFailures).toBe(1);
      expect(state.lastError).toContain("deadline");
      expect(state.nextRunAt).toBeGreaterThan(Date.now());
      // The wedged connection must be discarded so the next poll reconnects.
      expect(closed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

// ---------- H5 / H6 / H8 reliability-review regressions -------------------

function apptRow(id: string, ts: string): Record<string, unknown> {
  return {
    id,
    patient_id: `PAT-${id}`,
    termin_zeit: new Date(ts),
    modified_at: new Date(ts),
  };
}

const APPT_COLUMNS = ["id", "patient_id", "termin_zeit", "modified_at"];

/** Seed a steady-state (post-first-poll) StreamState so a poll skips the
 *  first-poll config validator and exercises the row loop directly. */
function seedSteadyState(cursor: string): void {
  saveState({
    vendorId: "tomedo-db",
    streamKind: "AppointmentCreated",
    cursor,
    cursorTiebreak: "",
    status: "idle",
    lastRunAt: 1,
    lastError: null,
    consecutiveFailures: 0,
    nextRunAt: 0,
    columnSnapshot: APPT_COLUMNS,
  });
}

describe("framework: outbox enqueue failure aborts the batch (review finding H5)", () => {
  it("does NOT advance the cursor past the failed row and records a backoff failure", async () => {
    const { vendor, driver } = await vendorAndDriver();
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        apptRow("1", "2026-05-20T10:00:00Z"),
        apptRow("2", "2026-05-20T10:01:00Z"),
        apptRow("3", "2026-05-20T10:02:00Z"),
      ],
    });
    // The outbox (SQLite) hits a transient SQLITE_BUSY on the second row.
    let seen = 0;
    const flakySink = () => {
      seen += 1;
      if (seen === 2) throw new Error("SQLITE_BUSY: database is locked");
    };
    let now = 1_000_000;
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: flakySink,
      now: () => now,
    });
    expect(outcome.emitted).toBe(0);

    const state = loadState("tomedo-db", "AppointmentCreated");
    // The whole batch aborted cursor-untouched: nothing was permanently lost.
    expect(state.cursor).toBe("");
    expect(state.consecutiveFailures).toBe(1);
    expect(state.lastError).toContain("enqueue failed");
    // Escaping failure goes through recordFailure -> backoff (nextRunAt pushed).
    expect(state.nextRunAt).toBeGreaterThan(now);

    // Retry once the outbox recovers: the cursor was left untouched, so the poll
    // RE-READS all three rows (the outbox UNIQUE dedup would collapse the two
    // that made it the first time; here the sink just re-collects them).
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        apptRow("1", "2026-05-20T10:00:00Z"),
        apptRow("2", "2026-05-20T10:01:00Z"),
        apptRow("3", "2026-05-20T10:02:00Z"),
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const retry = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => collected.push(e),
      now: () => now,
    });
    expect(retry.emitted).toBe(3);
    expect(collected.map((e) => e.pvsAppointmentId)).toEqual(["1", "2", "3"]);
    expect(loadState("tomedo-db", "AppointmentCreated").cursor).toBe(
      "2026-05-20T10:02:00.000Z"
    );
  });
});

describe("framework: bad-row normalization is skipped, not fatal (review finding H6)", () => {
  it("skips + counts a row whose required field fails to normalize and continues the poll", async () => {
    const { vendor, driver } = await vendorAndDriver();
    seedSteadyState("2026-05-20T09:00:00.000Z");
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        apptRow("1", "2026-05-20T10:00:00Z"),
        // A legacy MySQL zero-date arrives as an Invalid Date; termin_zeit is
        // the occurredAt source, so isoDateTime yields undefined -> the required
        // occurredAt is missing -> normalizeRow returns null for this row.
        {
          id: "2",
          patient_id: "PAT-2",
          termin_zeit: new Date(NaN),
          modified_at: new Date("2026-05-20T10:01:00Z"),
        },
        apptRow("3", "2026-05-20T10:02:00Z"),
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => collected.push(e),
    });
    expect(outcome.emitted).toBe(2);
    expect(outcome.skippedRows).toBe(1);
    expect(collected.map((e) => e.pvsAppointmentId)).toEqual(["1", "3"]);

    const state = loadState("tomedo-db", "AppointmentCreated");
    // The valid later row advances the cursor past the skipped one; the stream
    // stays healthy (no backoff, no halt) so it never hot-loops.
    expect(state.cursor).toBe("2026-05-20T10:02:00.000Z");
    expect(state.status).toBe("idle");
    expect(state.consecutiveFailures).toBe(0);
  });

  it("skips + counts a row that THROWS during normalization and stays healthy", async () => {
    const { vendor, driver } = await vendorAndDriver();
    seedSteadyState("2026-05-20T09:00:00.000Z");
    // A value whose String() throws makes the template expansion (and thus
    // normalizeRow) throw for this row only.
    const poison = {
      toString() {
        throw new Error("boom during String()");
      },
    };
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        apptRow("1", "2026-05-20T10:00:00Z"),
        {
          id: poison,
          patient_id: "PAT-X",
          termin_zeit: new Date("2026-05-20T10:01:00Z"),
          modified_at: new Date("2026-05-20T10:01:30Z"),
        },
        apptRow("3", "2026-05-20T10:02:00Z"),
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => collected.push(e),
    });
    expect(outcome.emitted).toBe(2);
    expect(outcome.skippedRows).toBe(1);
    expect(collected.map((e) => e.pvsAppointmentId)).toEqual(["1", "3"]);
    const state = loadState("tomedo-db", "AppointmentCreated");
    expect(state.status).toBe("idle");
    expect(state.consecutiveFailures).toBe(0);
    // The thrown row had a VALID cursor value, so the cursor may step past it;
    // the later valid row (3) is the true max.
    expect(state.cursor).toBe("2026-05-20T10:02:00.000Z");
  });

  it("a row that THROWS during first-poll validation does not escape pollOnce (counts as non-passing)", async () => {
    // First poll (no snapshot yet) runs validateFirstPoll. A poisoned value
    // would previously throw out of pollOnce to the runner's bare-log catch,
    // hot-looping the first poll with no backoff. It must instead count as a
    // failing sample and route to a config_invalid halt, never crash.
    const { vendor, driver } = await vendorAndDriver();
    const poison = {
      toString() {
        throw new Error("boom during first-poll String()");
      },
    };
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        { id: poison, patient_id: "PAT-1", termin_zeit: poison, modified_at: new Date("2026-05-20T10:00:00Z") },
        { id: poison, patient_id: "PAT-2", termin_zeit: poison, modified_at: new Date("2026-05-20T10:01:00Z") },
      ],
    });
    // Must resolve (not reject) and halt the stream rather than throwing.
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(outcome.emitted).toBe(0);
    expect(loadState("tomedo-db", "AppointmentCreated").status).toBe(
      "config_invalid"
    );
  });

  it("stringifyCursor returns '' for an Invalid Date instead of throwing", () => {
    const stream = { cursorType: "timestamp" } as unknown as StreamConfig;
    expect(_internal.stringifyCursor(new Date(NaN), stream)).toBe("");
    expect(
      _internal.stringifyCursor(new Date("2026-05-20T10:00:00Z"), stream)
    ).toBe("2026-05-20T10:00:00.000Z");
  });
});

// A keyset (tiebreak) config with a tiny batch so a full batch is easy to force
// and the tiebreak reset is observable.
const KEYSET_CONFIG_YAML = `
vendor: keyset-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 2
connection:
  credentialId: keyset-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND id > :cursorTiebreak))
      ORDER BY modified_at ASC, id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "ks:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

describe("framework: overlap window (review finding H8)", () => {
  async function keysetVendorAndDriver(): Promise<{
    vendor: VendorConfig;
    driver: StubDriver;
  }> {
    const vendor = await loadVendorConfigFromString(
      KEYSET_CONFIG_YAML,
      "keyset.yaml"
    );
    return { vendor, driver: new StubDriver() };
  }

  it("first poll binds the epoch sentinel with no lookback", async () => {
    const { vendor, driver } = await keysetVendorAndDriver();
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [apptRow("5", "2026-05-20T10:00:00Z")],
    });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect((driver.calls[0].params.cursor as Date).getTime()).toBe(0);
    expect(driver.calls[0].params.cursorTiebreak).toBe(0);
  });

  it("a CAUGHT-UP poll re-binds the cursor a lookback earlier and resets the tiebreak", async () => {
    const { vendor, driver } = await keysetVendorAndDriver();
    // First poll: one row (< batchSize 2) => caught up.
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [apptRow("5", "2026-05-20T10:00:00Z")],
    });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    // Second poll: caught up => overlap applies.
    driver.setNext({ columns: APPT_COLUMNS, rows: [] });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    const hwmMs = new Date("2026-05-20T10:00:00.000Z").getTime();
    const lookback = _internal.lookbackMs(vendor, vendor.streams[0]);
    expect((driver.calls[1].params.cursor as Date).getTime()).toBe(
      hwmMs - lookback
    );
    // The tiebreak is reset to 0 so a same-timestamp lower-id late row is
    // re-fetched (the whole point of the overlap).
    expect(driver.calls[1].params.cursorTiebreak).toBe(0);
  });

  it("a MID-DRAIN poll (previous batch full) keeps the STRICT keyset, no lookback", async () => {
    const { vendor, driver } = await keysetVendorAndDriver();
    // First poll returns a FULL batch (2 == batchSize 2) => still draining.
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        apptRow("5", "2026-05-20T10:00:00Z"),
        apptRow("6", "2026-05-20T10:00:00Z"),
      ],
    });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    driver.setNext({ columns: APPT_COLUMNS, rows: [] });
    await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    const hwmMs = new Date("2026-05-20T10:00:00.000Z").getTime();
    // Cursor NOT reduced (strict keyset) and tiebreak carries the real
    // high-water mark id (6), so the large same-timestamp cluster pages forward
    // instead of re-fetching its own head.
    expect((driver.calls[1].params.cursor as Date).getTime()).toBe(hwmMs);
    expect(driver.calls[1].params.cursorTiebreak).toBe(6);
  });

  it("lookbackMs is the larger of the floor and 2x the poll interval", () => {
    const lb = _internal.lookbackMs(
      { defaultIntervalSeconds: 60, batchSize: 1 } as unknown as VendorConfig,
      {} as unknown as StreamConfig
    );
    expect(lb).toBe(_internal.LOOKBACK_FLOOR_MS);
    const lbLong = _internal.lookbackMs(
      { defaultIntervalSeconds: 600, batchSize: 1 } as unknown as VendorConfig,
      {} as unknown as StreamConfig
    );
    expect(lbLong).toBe(2 * 600 * 1000);
  });
});

// ---------- L11 / L13 reliability-review regressions ----------------------

function uuidRow(uuid: string, ts: string): Record<string, unknown> {
  return {
    id: uuid,
    patient_id: `PAT-${uuid.slice(0, 4)}`,
    termin_zeit: new Date(ts),
    modified_at: new Date(ts),
  };
}

// A keyset config whose tiebreak is declared STRING (UUID primary key, L11).
const STRING_KEYSET_CONFIG_YAML = `
vendor: uuid-db
driver: postgres
bridgeSource: tomedo
defaultIntervalSeconds: 60
batchSize: 500
connection:
  credentialId: uuid-default
streams:
  - kind: AppointmentCreated
    cursorColumn: modified_at
    cursorType: timestamp
    tiebreakColumn: id
    tiebreakType: string
    query: |
      SELECT id, patient_id, termin_zeit, modified_at FROM termin
      WHERE (modified_at > :cursor OR (modified_at = :cursor AND id > :cursorTiebreak))
      ORDER BY modified_at ASC, id ASC LIMIT :limit
    map:
      pvsExternalEventId: { template: "uuid:appt:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
`;

describe("framework: non-numeric tiebreak handling (finding L11)", () => {
  const adv = _internal.cursorAdvances;

  it("compares a string-typed tiebreak LEXICALLY, not numerically", () => {
    // With tiebreakType string the raw text order wins: 'b' after 'a', and
    // "10" is BEFORE "9" lexically (the opposite of the integer default).
    expect(adv("2026-05-01", "b", "2026-05-01", "a", "timestamp", "string")).toBe(true);
    expect(adv("2026-05-01", "a", "2026-05-01", "b", "timestamp", "string")).toBe(false);
    expect(adv("2026-05-01", "10", "2026-05-01", "9", "timestamp", "string")).toBe(false);
  });

  it("keeps numeric tiebreak comparison when the type is unset (integer default)", () => {
    expect(adv("2026-05-01", "10", "2026-05-01", "9", "timestamp")).toBe(true);
    expect(adv("2026-05-01", "10", "2026-05-01", "9", "timestamp", "integer")).toBe(true);
  });

  it("halts as config_invalid when an integer-typed tiebreak returns a UUID value", async () => {
    // KEYSET_CONFIG_YAML declares tiebreakColumn id but NO tiebreakType, so it
    // defaults to integer. A UUID id would silently compare as NaN; the guard
    // must halt loudly instead.
    const vendor = await loadVendorConfigFromString(
      KEYSET_CONFIG_YAML,
      "keyset.yaml"
    );
    const driver = new StubDriver();
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        uuidRow("550e8400-e29b-41d4-a716-446655440000", "2026-05-20T10:00:00Z"),
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => collected.push(e),
    });
    expect(outcome.emitted).toBe(0);
    expect(collected).toHaveLength(0);

    const state = loadState("keyset-db", "AppointmentCreated");
    expect(state.status).toBe("config_invalid");
    expect(state.lastError).toContain("tiebreak not numeric");

    const pending = pendingDriftReports();
    expect(pending).toHaveLength(1);
    expect(pending[0].reportKind).toBe("config_invalid");
    expect(pending[0].configInvalidDetail!.issues[0].field).toBe("id");
  });

  it("a string-typed tiebreak (UUID key) polls, advances lexically, and does NOT halt", async () => {
    const vendor = await loadVendorConfigFromString(
      STRING_KEYSET_CONFIG_YAML,
      "uuid.yaml"
    );
    const driver = new StubDriver();
    const ts = "2026-05-20T10:00:00Z";
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [
        uuidRow("aaaaaaaa-0000-0000-0000-000000000001", ts),
        uuidRow("bbbbbbbb-0000-0000-0000-000000000002", ts),
      ],
    });
    const collected: CanonicalEventBase[] = [];
    const outcome = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => collected.push(e),
    });
    expect(outcome.emitted).toBe(2);

    const state = loadState("uuid-db", "AppointmentCreated");
    expect(state.status).toBe("idle");
    // Advanced to the lexically-greatest id (the "bbbb" one), not corrupted.
    expect(state.cursorTiebreak).toBe(
      "bbbbbbbb-0000-0000-0000-000000000002"
    );
    // First poll binds the STRING sentinel "" (not the numeric 0).
    expect(driver.calls[0].params.cursorTiebreak).toBe("");
  });
});

describe("framework: catch-up scheduling (finding L13)", () => {
  it("schedules a short next run after a FULL batch (drain the backlog)", async () => {
    const { vendor, driver } = await vendorAndDriver();
    seedSteadyState("2026-05-20T09:00:00.000Z");
    const smallBatch = { ...vendor, batchSize: 1 };
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [apptRow("1", "2026-05-20T10:00:00Z")],
    });
    const T = 5_000_000;
    await pollOnce({
      clinicId: "c1",
      vendor: smallBatch,
      stream: smallBatch.streams[0],
      driver,
      sink: () => void 0,
      now: () => T,
    });
    const state = loadState("tomedo-db", "AppointmentCreated");
    // Full batch (1 row == batchSize 1) => re-poll after the short catch-up
    // delay, NOT the full 60s interval.
    expect(state.nextRunAt).toBe(T + 1_000);
  });

  it("schedules the full interval after a SHORT batch (caught up)", async () => {
    const { vendor, driver } = await vendorAndDriver();
    seedSteadyState("2026-05-20T09:00:00.000Z");
    const bigBatch = { ...vendor, batchSize: 5 };
    driver.setNext({
      columns: APPT_COLUMNS,
      rows: [apptRow("1", "2026-05-20T10:00:00Z")],
    });
    const T = 5_000_000;
    await pollOnce({
      clinicId: "c1",
      vendor: bigBatch,
      stream: bigBatch.streams[0],
      driver,
      sink: () => void 0,
      now: () => T,
    });
    const state = loadState("tomedo-db", "AppointmentCreated");
    // Short batch (1 < batchSize 5) => normal cadence (60s).
    expect(state.nextRunAt).toBe(T + 60_000);
  });
});

const STATUS_YAML = `
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
      SELECT id, patient_id, termin_zeit, status_code, modified_at FROM termin
      WHERE modified_at > :cursor LIMIT :limit
    map:
      pvsExternalEventId: { template: "tomedo:appointment:{id}" }
      occurredAt: { from: termin_zeit, transform: isoDateTime }
      pvsPatientId: patient_id
      pvsAppointmentId: id
      scheduledAt: { from: termin_zeit, transform: isoDateTime }
      newStatus: { from: status_code, transform: appointmentStatus }
`;

describe("framework: post-baseline value drift (M-D2)", () => {
  const STATUS_COLS = [
    "id",
    "patient_id",
    "termin_zeit",
    "status_code",
    "modified_at",
  ];

  it("counts emitted events that dropped a key-transform field for an unmapped value", async () => {
    const vendor = await loadVendorConfigFromString(STATUS_YAML, "status.yaml");
    const driver = new StubDriver();
    // Poll 1: a recognised status baselines the stream.
    driver.setNext({
      columns: STATUS_COLS,
      rows: [
        {
          id: "A1",
          patient_id: "P1",
          termin_zeit: "2026-05-20T10:00:00Z",
          status_code: "geplant",
          modified_at: new Date("2026-05-20T10:00:00Z"),
        },
      ],
    });
    const first: CanonicalEventBase[] = [];
    const o1 = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => first.push(e),
    });
    expect(o1.emitted).toBe(1);
    expect(o1.unmappedValues ?? 0).toBe(0);
    expect(first[0].newStatus).toBe("scheduled");

    // Poll 2: a status code a vendor update introduced that the map does not
    // recognise. The event still ships (envelope + required fields resolve), but
    // newStatus is dropped; the value-drift watch counts it.
    driver.setNext({
      columns: STATUS_COLS,
      rows: [
        {
          id: "A2",
          patient_id: "P2",
          termin_zeit: "2026-05-21T10:00:00Z",
          status_code: "teilbehandelt",
          modified_at: new Date("2026-05-21T10:00:00Z"),
        },
      ],
    });
    const second: CanonicalEventBase[] = [];
    const o2 = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: (e) => second.push(e),
    });
    expect(o2.emitted).toBe(1);
    expect(o2.unmappedValues).toBe(1);
    // The event shipped without the unrecognised status (portal would drop it).
    expect(second[0].newStatus).toBeUndefined();
    // The stream stays healthy: value drift never halts it.
    expect(loadState("tomedo-db", "AppointmentCreated").status).toBe("idle");
  });

  it("does not flag a genuinely empty (NULL) key-transform source", async () => {
    const vendor = await loadVendorConfigFromString(STATUS_YAML, "status.yaml");
    const driver = new StubDriver();
    driver.setNext({
      columns: STATUS_COLS,
      rows: [
        {
          id: "A1",
          patient_id: "P1",
          termin_zeit: "2026-05-20T10:00:00Z",
          status_code: "geplant",
          modified_at: new Date("2026-05-20T10:00:00Z"),
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
    driver.setNext({
      columns: STATUS_COLS,
      rows: [
        {
          id: "A2",
          patient_id: "P2",
          termin_zeit: "2026-05-21T10:00:00Z",
          status_code: null,
          modified_at: new Date("2026-05-21T10:00:00Z"),
        },
      ],
    });
    const o = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(o.emitted).toBe(1);
    // A NULL optional status is an empty field, not an unmapped value.
    expect(o.unmappedValues ?? 0).toBe(0);
  });
});

describe("framework: first-poll validation samples the newest rows (M-D7)", () => {
  function apptRow(i: number, valid: boolean): Record<string, unknown> {
    return valid
      ? {
          id: `A${i}`,
          patient_id: `P${i}`,
          termin_zeit: "2026-05-20T10:00:00Z",
          modified_at: `2026-05-20T10:00:00Z`,
        }
      : {
          // Legacy-format row: no appointment time / patient id resolves, so the
          // envelope + required fields fail (the shape 20-year-old data has).
          id: `A${i}`,
          patient_id: null,
          termin_zeit: null,
          modified_at: `2026-05-20T10:00:00Z`,
        };
  }

  it("accepts a config whose OLD rows are legacy-invalid but whose NEWEST rows are valid", async () => {
    const { vendor } = await vendorAndDriver();
    const ctx = { clinicId: "c1", vendor, stream: vendor.streams[0] };
    // 50 rows in ASC (cursor) order: the first 25 (oldest) are legacy-invalid,
    // the last 25 (newest) are current-format valid. Head-sampling would halt
    // this healthy config as config_invalid; newest-sampling accepts it.
    const rows = [
      ...Array.from({ length: 25 }, (_, i) => apptRow(i, false)),
      ...Array.from({ length: 25 }, (_, i) => apptRow(100 + i, true)),
    ];
    const v = _internal.validateFirstPoll(rows, ctx);
    expect(v.ok).toBe(true);
    expect(v.sampleSize).toBe(25);
    expect(v.passingRows).toBe(25);
  });

  it("rejects a config whose NEWEST rows are the broken ones (proves it samples the tail, not the head)", async () => {
    const { vendor } = await vendorAndDriver();
    const ctx = { clinicId: "c1", vendor, stream: vendor.streams[0] };
    const rows = [
      ...Array.from({ length: 25 }, (_, i) => apptRow(i, true)),
      ...Array.from({ length: 25 }, (_, i) => apptRow(100 + i, false)),
    ];
    const v = _internal.validateFirstPoll(rows, ctx);
    expect(v.ok).toBe(false);
  });
});

describe("framework: an envelope-invalid batch advances the cursor (M-D1)", () => {
  it("skips envelope-invalid rows but steps the cursor past them so the stream never re-polls the same batch forever", async () => {
    const { vendor, driver } = await vendorAndDriver();
    const cols = ["id", "patient_id", "termin_zeit", "modified_at"];
    // Poll 1: a valid row baselines the stream (validateFirstPoll must pass so
    // the batch below reaches the normal poll path, not the first-poll halt).
    driver.setNext({
      columns: cols,
      rows: [
        {
          id: "A1",
          patient_id: "P1",
          termin_zeit: "2026-05-20T10:00:00Z",
          modified_at: new Date("2026-05-20T10:00:00Z"),
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

    // Poll 2: a full batch of envelope-invalid rows (termin_zeit NULL =>
    // occurredAt missing => normalizeRow returns null), each with a VALID
    // modified_at cursor value. Nothing emits, but the cursor MUST advance past
    // them; otherwise the same batch re-polls forever at idle (the M-D1 wedge).
    driver.setNext({
      columns: cols,
      rows: [
        {
          id: "B1",
          patient_id: null,
          termin_zeit: null,
          modified_at: new Date("2026-05-21T09:00:00Z"),
        },
        {
          id: "B2",
          patient_id: null,
          termin_zeit: null,
          modified_at: new Date("2026-05-21T10:00:00Z"),
        },
      ],
    });
    const o = await pollOnce({
      clinicId: "c1",
      vendor,
      stream: vendor.streams[0],
      driver,
      sink: () => void 0,
    });
    expect(o.emitted).toBe(0);
    expect(o.skippedRows).toBe(2);
    const state = loadState("tomedo-db", "AppointmentCreated");
    // Cursor advanced to the newest invalid row rather than staying frozen at
    // poll 1's cursor.
    expect(state.cursor).toBe("2026-05-21T10:00:00.000Z");
    expect(state.status).toBe("idle");
  });
});
