// Pin the process timezone to UTC for the whole real-engine harness BEFORE any
// Date is constructed or any DB client library initialises. Two of the four
// server engines (Oracle TIMESTAMP, Firebird TIMESTAMP) have no per-connection
// UTC switch: their client libraries convert a TIMESTAMP WITHOUT TIME ZONE
// using the Node process timezone. The cursor round-trip (Phase 3) reads a
// stored timestamp back as a JS Date, stringifies it to ISO, then on the next
// poll binds that ISO back as a Date. For poll #2's boundary-equality check
// (`modified_at = :cursor`) to hold, read and bind must be exact inverses; a
// non-UTC process offset would shift the bound value by that offset and either
// re-emit every row (visible test failure) or silently skip rows (the worse,
// production-relevant outcome). Forcing UTC collapses every engine's read/bind
// path to one timezone, so the inverse is exact. mysql2 (timezone:'Z') and
// tedious (useUTC default) are already UTC; this makes the other two match.
// Node honours a runtime assignment to process.env.TZ for subsequent Date ops.
process.env.TZ = "UTC";

import BetterSqlite3 from "better-sqlite3";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  _setStateDbForTesting,
  loadState,
  pendingDriftReports,
  pollOnce,
} from "./framework.js";
import type {
  DbConnectionParams,
  DbDriver,
  StreamConfig,
  VendorConfig,
} from "./types.js";

/**
 * Shared scaffolding for the Phase 6 real-engine integration harness.
 *
 * Phases 3-5 (bind a Date not a string; keyset pagination; first-poll value
 * validation) were only ever exercised against pg-mem (Postgres) and a real
 * SQLite file. Five of the six engines had never run. This module hosts the
 * engine-agnostic half of the harness: the gating flag, the in-memory
 * framework-state DB, the canonical patient seed, a retry-connect helper, and
 * the three standard assertions every engine must pass. Each engine's own
 * `*.it.test.ts` file supplies a `EngineHarness` (its testcontainer + the
 * dialect-specific DDL/seed/rename) and calls `runStandardHarness`.
 *
 * Gating: the whole suite is `describe.skipIf(!IT_ENABLED)`, so a normal
 * `vitest run` (and the existing CI `bridge` job, which does not set the env)
 * collects these files but never starts a container. Only
 * `PVS_DB_IT=1 pnpm --filter eins-agent test` (the dedicated CI job) runs them.
 */

/** True only when explicitly opted in; keeps local `vitest run` Docker-free. */
export const IT_ENABLED = process.env.PVS_DB_IT === "1";

/** A real Praxis clinic id (any UUID; the harness never hits the portal). */
export const CLINIC = "33333333-3333-3333-3333-333333333333";

// Container boot (image already cached) plus first-connection readiness; Oracle
// and MSSQL open their TCP port well before the engine accepts logins, so the
// per-engine seed retries within this window. Generous on purpose.
const BOOT_TIMEOUT_MS = 360_000;
// Per-test budget. The keyset drain runs ~32 polls; every poll is one fast
// round-trip query, so this is mostly slack for a cold connection.
const TEST_TIMEOUT_MS = 120_000;

/** Engine-neutral description of one patient row. Each harness maps these
 *  fields onto its own column names and binds the temporal fields as JS Date
 *  objects (never literals) so write/read share the driver library's exact
 *  Date<->TIMESTAMP convention. */
export interface SeedPatient {
  /** Numeric primary key; doubles as the keyset tiebreak. */
  id: number;
  vorname: string;
  nachname: string;
  email: string;
  telefonMobil: string;
  telefonPrivat: string;
  /** ISO date 'YYYY-MM-DD'. */
  geburtsdatum: string;
  /** Raw gender code the `gender` transform understands. */
  geschlecht: string;
  bemerkung: string;
  /** ISO-8601 'Z' instant; bound as `new Date(modifiedAt)`. */
  modifiedAt: string;
}

function patient(id: number, modifiedAt: string): SeedPatient {
  return {
    id,
    vorname: `Vor${id}`,
    nachname: `Nach${id}`,
    email: `p${id}@praxis.de`,
    telefonMobil: "+49 30 0000",
    telefonPrivat: "+49 30 1111",
    geburtsdatum: "1980-01-01",
    geschlecht: "w",
    bemerkung: "EINS-Lead-abcd1234",
    modifiedAt,
  };
}

/** Three patients with strictly ascending, distinct modified_at: the cursor
 *  advances to the latest and a second identical poll returns nothing. */
export function roundTripPatients(): SeedPatient[] {
  return [
    patient(1, "2026-05-20T10:00:00.000Z"),
    patient(2, "2026-05-20T11:00:00.000Z"),
    patient(3, "2026-05-20T12:00:00.000Z"),
  ];
}

/** A single patient newer than every roundTripPatients() row, for the third
 *  poll of the round-trip test. */
export function newerPatient(): SeedPatient {
  return patient(4, "2026-05-21T09:00:00.000Z");
}

/** Mixed-digit-length ids 9..100 (92 rows). The mixed lengths are what make
 *  the keyset test discriminating: a lexical tiebreak would strand "10".."99"
 *  behind "100"/"9"; the framework advances the tiebreak numerically. */
export function clusterIds(): number[] {
  const ids: number[] = [];
  for (let id = 9; id <= 100; id++) ids.push(id);
  return ids;
}

/** One fat cluster of patients that ALL carry the same modified_at (a bulk
 *  import stamps one transaction timestamp on every row): the exact shape the
 *  old single-column `WHERE modified_at > :cursor` silently split. */
export function clusterPatients(ids: number[]): SeedPatient[] {
  const ts = "2026-07-01T00:00:00.000Z";
  return ids.map((id) => patient(id, ts));
}

/**
 * Install a fresh in-memory SQLite handle as the framework's state DB, with the
 * exact schema framework.ts expects. Mirrors the beforeEach in
 * integration.test.ts / integration.sqlite.test.ts so each test starts from a
 * virgin cursor.
 */
export function installFreshStateDb(): void {
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
}

/**
 * Retry an async connect/seed step until it succeeds or the window elapses.
 * The TCP port a testcontainer exposes accepts connections before the engine
 * (Oracle, SQL Server especially) finishes booting, so the first few attempts
 * legitimately throw. Rethrows the last error on timeout so a genuine
 * misconfiguration still fails loudly.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs: number; intervalMs?: number; label: string }
): Promise<T> {
  const interval = opts.intervalMs ?? 2_000;
  const deadline = Date.now() + opts.timeoutMs;
  let lastErr: unknown;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await delay(interval);
    }
  }
  throw new Error(
    `${opts.label}: not ready after ${opts.timeoutMs}ms (${attempt} attempts). Last error: ${
      (lastErr as Error)?.message ?? String(lastErr)
    }`
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The engine-specific half of the harness. A `*.it.test.ts` builds one of
 * these around its live container and hands it to runStandardHarness.
 */
export interface EngineHarness {
  /** Human label for the describe block. */
  label: string;
  /** Loaded vendor config for this engine. */
  vendor: VendorConfig;
  /** Same config with batchSize forced to 3, for the keyset boundary test. */
  smallBatchVendor: VendorConfig;
  /** The PatientUpserted stream (the simplest schema the harness seeds). */
  stream: StreamConfig;
  /** A fresh, unconnected production driver instance. */
  newDriver(): DbDriver;
  /** Connection params pointing at the live container. */
  connectionParams(): DbConnectionParams;
  /** Drop + recreate the patient table and insert exactly these rows. Drop+
   *  recreate (not truncate) so a prior test's renamed column is reset too. */
  seedPatients(rows: SeedPatient[]): Promise<void>;
  /** Insert one more patient without touching the rest. */
  addPatient(row: SeedPatient): Promise<void>;
  /** Rename the patient table's `email` source column so the stream's
   *  explicit-column SELECT throws this engine's undefined-column error. */
  renameEmailColumn(): Promise<void>;
}

/**
 * Define the three standard assertions for one engine. `factory` boots the
 * container and returns the harness plus a teardown; it runs once in beforeAll
 * and is skipped entirely (no container) unless PVS_DB_IT=1.
 */
export function runStandardHarness(
  label: string,
  factory: () => Promise<{ harness: EngineHarness; teardown: () => Promise<void> }>
): void {
  describe.skipIf(!IT_ENABLED)(`real-engine harness: ${label}`, () => {
    let h: EngineHarness;
    let teardown: () => Promise<void>;

    beforeAll(async () => {
      const r = await factory();
      h = r.harness;
      teardown = r.teardown;
    }, BOOT_TIMEOUT_MS);

    afterAll(async () => {
      if (teardown) await teardown();
    }, BOOT_TIMEOUT_MS);

    beforeEach(() => installFreshStateDb());
    afterEach(() => _setStateDbForTesting(null));

    // Phase 3. With the pre-fix code the framework bound the cursor as an
    // ISO-8601 'Z' STRING, which every server engine except Postgres throws on
    // or matches nothing against a native TIMESTAMP. Binding a Date makes the
    // store-as-ISO / bind-as-Date round-trip work; this proves it per engine.
    it("round-trips a timestamp cursor across two polls", async () => {
      await h.seedPatients(roundTripPatients());
      const driver = h.newDriver();
      await driver.connect(h.connectionParams());
      try {
        const seen: string[] = [];
        const first = await pollOnce({
          clinicId: CLINIC,
          vendor: h.vendor,
          stream: h.stream,
          driver,
          sink: (e) => seen.push(String(e.pvsPatientId)),
        });
        expect(first.emitted).toBe(3);
        expect(seen.slice().sort()).toEqual(["1", "2", "3"]);
        expect(first.newCursor).not.toBe("");

        // Same data, same cursor: nothing new, cursor frozen. A skipped-row
        // (cursor leapt past the boundary) or re-read (cursor stuck) regression
        // both fail here.
        const second = await pollOnce({
          clinicId: CLINIC,
          vendor: h.vendor,
          stream: h.stream,
          driver,
          sink: () => {
            throw new Error("second poll must emit nothing");
          },
        });
        expect(second.emitted).toBe(0);
        expect(second.newCursor).toBe(first.newCursor);

        // A newer row is picked up; the cursor advances past the prior max.
        await h.addPatient(newerPatient());
        const third = await pollOnce({
          clinicId: CLINIC,
          vendor: h.vendor,
          stream: h.stream,
          driver,
          sink: () => void 0,
        });
        expect(third.emitted).toBe(1);
        expect(third.newCursor > first.newCursor).toBe(true);
      } finally {
        await driver.close();
      }
    }, TEST_TIMEOUT_MS);

    // Phase 4. A cluster of rows sharing one modified_at, drained with a batch
    // size far smaller than the cluster, must emit every row exactly once: no
    // skip at the boundary (the old bug), no duplicate from re-reading.
    it("emits every row when a batch boundary splits one shared timestamp", async () => {
      const ids = clusterIds();
      await h.seedPatients(clusterPatients(ids));
      const driver = h.newDriver();
      await driver.connect(h.connectionParams());
      try {
        const seen: string[] = [];
        // 92 rows / batchSize 3 = 31 emitting polls + 1 empty; the cap is a
        // livelock guard (a non-advancing cursor would spin instead of hang).
        for (let i = 0; i < 200; i++) {
          const out = await pollOnce({
            clinicId: CLINIC,
            vendor: h.smallBatchVendor,
            stream: h.stream,
            driver,
            sink: (e) => seen.push(String(e.pvsPatientId)),
          });
          if (out.emitted === 0) break;
        }
        expect(seen.slice().sort()).toEqual(ids.map(String).sort());
        expect(new Set(seen).size).toBe(ids.length);
      } finally {
        await driver.close();
      }
    }, TEST_TIMEOUT_MS);

    // Phase 6 / framework finding 2. A renamed source column makes the
    // explicit-column SELECT THROW (the result-set shape never changes, so the
    // column-snapshot detector can't see it). isSchemaError must recognise THIS
    // engine's undefined-column error and halt the stream as drift rather than
    // retry a permanent condition forever.
    it("classifies a renamed column as schema drift and halts the stream", async () => {
      await h.seedPatients(roundTripPatients());
      const driver = h.newDriver();
      await driver.connect(h.connectionParams());
      try {
        const healthy = await pollOnce({
          clinicId: CLINIC,
          vendor: h.vendor,
          stream: h.stream,
          driver,
          sink: () => void 0,
        });
        expect(healthy.emitted).toBe(3);
        expect(healthy.driftDetected).toBe(false);

        await h.renameEmailColumn();

        const drifted = await pollOnce({
          clinicId: CLINIC,
          vendor: h.vendor,
          stream: h.stream,
          driver,
          sink: () => {
            throw new Error("sink must not run once the query errors");
          },
        });
        expect(drifted.driftDetected).toBe(true);
        expect(drifted.emitted).toBe(0);
        expect(drifted.driftReport).not.toBeNull();

        const state = loadState(h.vendor.vendor, h.stream.kind);
        expect(state.status).toBe("schema_drift");
        expect(pendingDriftReports().length).toBeGreaterThan(0);
      } finally {
        await driver.close();
      }
    }, TEST_TIMEOUT_MS);
  });
}
