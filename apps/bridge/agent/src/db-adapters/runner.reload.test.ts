import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { startRunner, defaultConfigsDir, type RunnerHandle } from "./runner.js";
import { _setStateDbForTesting, loadState, saveState } from "./framework.js";
import { loadAllVendorConfigs } from "./vendor-config.js";
import type {
  DbConnectionParams,
  DbDriver,
  QueryResult,
  VendorConfig,
} from "./types.js";

/**
 * Hot config reload (remote config push).
 *
 * The three things reloadVendor has to get right are all failure modes we
 * would otherwise only discover on a Praxis machine:
 *
 *   • a stream halted by drift stays halted forever unless the reload clears it
 *     (making the whole push pointless),
 *   • the old column snapshot re-triggers drift on the very next poll,
 *   • a cursor bound into a column of a different type breaks every query.
 */

const VENDOR_ID = "tomedo-db";

class FakeDriver implements DbDriver {
  readonly engine = "postgres" as const;
  async connect(_params: DbConnectionParams): Promise<void> {}
  async query(): Promise<QueryResult> {
    return { columns: [], rows: [] };
  }
  async close(): Promise<void> {}
  async healthCheck(): Promise<{ ok: true } | { ok: false; reason: string }> {
    return { ok: true };
  }
}

let handle: RunnerHandle | null = null;
let vendor: VendorConfig;
let driversBuilt = 0;

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
  `);
  _setStateDbForTesting(db);
  driversBuilt = 0;
  const configs = await loadAllVendorConfigs(defaultConfigsDir());
  vendor = configs.get(VENDOR_ID)!;
});

afterEach(async () => {
  if (handle) await handle.stop();
  handle = null;
  _setStateDbForTesting(null);
});

async function makeRunner(): Promise<RunnerHandle> {
  return startRunner({
    clinicId: "11111111-1111-1111-1111-111111111111",
    enabledVendors: [VENDOR_ID],
    connections: { [VENDOR_ID]: { host: "h", username: "u" } },
    driverFactory: () => {
      driversBuilt++;
      return new FakeDriver();
    },
    credentialLoader: async () => "pw",
    tickMs: 3_600_000,
    // Pin to the bundled configs: this suite is about the swap itself, not
    // about whatever the machine running the tests happens to have cached.
    remoteConfigs: new Map(),
  });
}

function haltFirstStream(status: "schema_drift" | "config_invalid" | "error"): void {
  const kind = vendor.streams[0]!.kind;
  saveState({
    vendorId: VENDOR_ID,
    streamKind: kind,
    cursor: "2026-01-01T00:00:00Z",
    cursorTiebreak: "42",
    status,
    lastRunAt: 1_000,
    lastError: "column termin.status_id does not exist",
    consecutiveFailures: 7,
    nextRunAt: Date.now() + 3_600_000,
    columnSnapshot: ["id", "status_id"],
    });
}

describe("reloadVendor", () => {
  it("clears a drift halt so the fixed stream runs again", async () => {
    handle = await makeRunner();
    haltFirstStream("schema_drift");
    const kind = vendor.streams[0]!.kind;

    expect(handle.reloadVendor(VENDOR_ID, vendor)).toBe(true);

    const state = loadState(VENDOR_ID, kind);
    expect(state.status).toBe("idle");
    expect(state.lastError).toBeNull();
    expect(state.consecutiveFailures).toBe(0);
    // Due immediately: a Praxis should recover within a tick, not after the
    // stream's normal interval.
    expect(state.nextRunAt).toBe(0);
  });

  it("clears the column snapshot so the new shape does not re-trigger drift", async () => {
    handle = await makeRunner();
    haltFirstStream("schema_drift");

    handle.reloadVendor(VENDOR_ID, vendor);

    expect(loadState(VENDOR_ID, vendor.streams[0]!.kind).columnSnapshot).toBeNull();
  });

  it("keeps the cursor when the cursor type is unchanged", async () => {
    handle = await makeRunner();
    haltFirstStream("error");

    handle.reloadVendor(VENDOR_ID, vendor);

    const state = loadState(VENDOR_ID, vendor.streams[0]!.kind);
    expect(state.cursor).toBe("2026-01-01T00:00:00Z");
    expect(state.cursorTiebreak).toBe("42");
  });

  it("resets the cursor when the cursor type changed under it", async () => {
    handle = await makeRunner();
    haltFirstStream("error");

    const retyped: VendorConfig = {
      ...vendor,
      streams: vendor.streams.map((s, i) =>
        i === 0
          ? { ...s, cursorType: s.cursorType === "integer" ? "timestamp" : "integer" }
          : s
      ),
    };
    handle.reloadVendor(VENDOR_ID, retyped);

    const state = loadState(VENDOR_ID, vendor.streams[0]!.kind);
    expect(state.cursor).toBe("");
    expect(state.cursorTiebreak).toBe("");
  });

  it("leaves a deliberately disabled stream disabled", async () => {
    handle = await makeRunner();
    const kind = vendor.streams[0]!.kind;
    saveState({
      vendorId: VENDOR_ID,
      streamKind: kind,
      cursor: "",
      cursorTiebreak: "",
      status: "disabled",
      lastRunAt: null,
      lastError: null,
      consecutiveFailures: 0,
      nextRunAt: 0,
      columnSnapshot: null,
    });

    handle.reloadVendor(VENDOR_ID, vendor);

    expect(loadState(VENDOR_ID, kind).status).toBe("disabled");
  });

  it("rebuilds the connection when connection parameters changed", async () => {
    handle = await makeRunner();
    const built = driversBuilt;

    handle.reloadVendor(VENDOR_ID, {
      ...vendor,
      connection: { ...vendor.connection, database: "a-different-db" },
    });

    expect(driversBuilt).toBe(built + 1);
  });

  it("keeps the connection for a pure SQL / mapping change", async () => {
    handle = await makeRunner();
    const built = driversBuilt;

    handle.reloadVendor(VENDOR_ID, {
      ...vendor,
      streams: vendor.streams.map((s) => ({ ...s, query: `${s.query} -- touched` })),
    });

    expect(driversBuilt).toBe(built);
  });

  it("reports the newly configured streams to the heartbeat", async () => {
    handle = await makeRunner();
    const trimmed: VendorConfig = { ...vendor, streams: [vendor.streams[0]!] };

    handle.reloadVendor(VENDOR_ID, trimmed);

    expect(handle.statusSnapshot().map((s) => s.stream)).toEqual([
      vendor.streams[0]!.kind,
    ]);
  });

  it("refuses a vendor this agent does not run", async () => {
    handle = await makeRunner();
    expect(handle.reloadVendor("not-enabled-db", vendor)).toBe(false);
    expect(handle.enabledVendors()).toEqual([VENDOR_ID]);
  });
});
