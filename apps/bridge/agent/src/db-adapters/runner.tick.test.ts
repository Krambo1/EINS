import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { startRunner, defaultConfigsDir, type RunnerHandle } from "./runner.js";
import { _setStateDbForTesting, saveState } from "./framework.js";
import { loadAllVendorConfigs } from "./vendor-config.js";
import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
  StreamState,
  VendorConfig,
} from "./types.js";

/**
 * Runner tick tests for finding L14: a vendor's healthCheck() must only fire
 * when at least one of its streams is actually due, not on every 5s tick.
 */

const VENDOR_ID = "tomedo-db";

class CountingDriver implements DbDriver {
  readonly engine = "postgres" as const;
  connects = 0;
  healthChecks = 0;
  queries = 0;
  async connect(_params: DbConnectionParams): Promise<void> {
    this.connects++;
  }
  async query(): Promise<QueryResult> {
    this.queries++;
    // Return an empty (zero-column) result so pollOnce is a healthy no-op that
    // does not baseline or emit anything.
    return { columns: [], rows: [] };
  }
  async close(): Promise<void> {
    return;
  }
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    this.healthChecks++;
    return { ok: true };
  }
}

let handle: RunnerHandle | null = null;
let vendor: VendorConfig;

beforeEach(async () => {
  const db = new Database(":memory:");
  db.exec(`
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
  _setStateDbForTesting(db);
  const configs = await loadAllVendorConfigs(defaultConfigsDir());
  vendor = configs.get(VENDOR_ID)!;
});

afterEach(async () => {
  if (handle) await handle.stop();
  handle = null;
});

function seedNextRunAt(nextRunAt: number): void {
  for (const stream of vendor.streams) {
    const state: StreamState = {
      vendorId: VENDOR_ID,
      streamKind: stream.kind,
      cursor: "",
      cursorTiebreak: "",
      status: "idle",
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt,
      columnSnapshot: null,
    };
    saveState(state);
  }
}

async function makeRunner(driver: CountingDriver): Promise<RunnerHandle> {
  return startRunner({
    clinicId: "11111111-1111-1111-1111-111111111111",
    enabledVendors: [VENDOR_ID],
    connections: { [VENDOR_ID]: { host: "h", username: "u" } },
    driverFactory: () => driver,
    credentialLoader: async () => "pw",
    tickMs: 3_600_000, // effectively never auto-fires; we drive tickOnce.
  });
}

describe("runner: healthCheck only fires when a stream is due (finding L14)", () => {
  it("does NOT connect or health-check when every stream's nextRunAt is in the future", async () => {
    const driver = new CountingDriver();
    seedNextRunAt(Date.now() + 60 * 60_000); // all far in the future
    handle = await makeRunner(driver);

    await handle.tickOnce();
    await handle.tickOnce();

    // Nothing due -> the connection is never touched, so no health check and
    // no reconnect round-trips against the Praxis DB.
    expect(driver.healthChecks).toBe(0);
    expect(driver.connects).toBe(0);
    expect(driver.queries).toBe(0);
  });

  it("connects then health-checks only on ticks where a stream is due", async () => {
    const driver = new CountingDriver();
    seedNextRunAt(0); // all due now
    handle = await makeRunner(driver);

    // Tick 1: due + not yet connected -> connect (no health check on the
    // freshly-established connection), and poll each stream once.
    await handle.tickOnce();
    expect(driver.connects).toBe(1);
    expect(driver.healthChecks).toBe(0);
    expect(driver.queries).toBe(vendor.streams.length);

    // Make sure nothing is due on the next tick (pin every stream's schedule
    // into the future explicitly, independent of the poll's own cadence).
    seedNextRunAt(Date.now() + 60 * 60_000);
    await handle.tickOnce();
    // Still connected but nothing due -> no health check this tick.
    expect(driver.healthChecks).toBe(0);

    // Now make them due again while connected -> ensureConnected runs a health
    // check before polling.
    seedNextRunAt(0);
    await handle.tickOnce();
    expect(driver.healthChecks).toBe(1);
  });
});

describe("runner: statusSnapshot exposes live adapter status (M-D4)", () => {
  it("reports each stream's persisted status (error / drift) for the heartbeat", async () => {
    const driver = new CountingDriver();
    seedNextRunAt(Date.now() + 60 * 60_000); // nothing due; we drive state directly
    handle = await makeRunner(driver);

    const first = vendor.streams[0];
    saveState({
      vendorId: VENDOR_ID,
      streamKind: first.kind,
      cursor: "",
      cursorTiebreak: "",
      status: "error",
      lastRunAt: 123,
      lastError: "connect ECONNREFUSED",
      consecutiveFailures: 5,
      nextRunAt: 0,
      columnSnapshot: null,
    });

    const snap = handle.statusSnapshot();
    expect(snap.length).toBe(vendor.streams.length);
    const errored = snap.find((s) => s.stream === first.kind);
    expect(errored?.status).toBe("error");
    expect(errored?.lastError).toBe("connect ECONNREFUSED");
    expect(errored?.consecutiveFailures).toBe(5);
    // The connectError field always rides along (null when there is no
    // vendor-level connection failure).
    expect(errored && "connectError" in errored).toBe(true);
  });

  it("records a connectError when the DB credential is missing (rotated-password shape)", async () => {
    const driver = new CountingDriver();
    seedNextRunAt(0); // due now, so ensureConnected runs
    handle = await startRunner({
      clinicId: "11111111-1111-1111-1111-111111111111",
      enabledVendors: [VENDOR_ID],
      connections: { [VENDOR_ID]: { host: "h", username: "u" } },
      driverFactory: () => driver,
      credentialLoader: async () => null, // secure-store has no/stale credential
      tickMs: 3_600_000,
    });

    await handle.tickOnce();

    const snap = handle.statusSnapshot();
    // A rotated/missing credential never touches db_adapter_state, so status
    // stays a stale 'idle'; connectError is what surfaces the real problem.
    expect(snap[0].connectError).toMatch(/no credential/);
    expect(driver.connects).toBe(0); // never reached driver.connect()
  });
});
