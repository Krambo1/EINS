import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { OracleDriver } from "./drivers/oracle.js";
import {
  runStandardHarness,
  withRetry,
  type EngineHarness,
  type SeedPatient,
} from "./it-support.js";
import { loadVendorConfigFile } from "./vendor-config.js";

/**
 * Real-engine integration for the Oracle driver, exercised through the bundled
 * cgm-m1pro-oracle.yaml against a live Oracle container. CGM M1 PRO's dominant
 * install base is Oracle. Uses gvenzl/oracle-free (Oracle Database 23ai), which
 * is 12c+ as the oracledb Thin client requires (Thin ignores NLS, which is why
 * Phase 3 binds a Date rather than an ISO string).
 *
 * This harness is also what surfaced the driver's UPPERCASE-column bug: Oracle
 * reports unquoted aliases as `ID`/`MODIFIED_AT`, the configs address them in
 * lower case, and OracleDriver now lower-cases keys (see drivers/oracle.ts).
 * Proves the Phase 3 Date bind, the Phase 4 keyset (FETCH FIRST :limit), and
 * the per-engine schema-error classification (ORA-00904). Gated behind
 * PVS_DB_IT=1.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML = join(HERE, "configs", "cgm-m1pro-oracle.yaml");

const APP_USER = "eins";
const APP_PASSWORD = "eins_pw";
const ORACLE_PASSWORD = "oracle_pw";
// gvenzl/oracle-free exposes the application pluggable database as FREEPDB1.
const SERVICE = "FREEPDB1";

// Minimal slice of the oracledb surface this seed needs; the production driver
// declares its own. Avoids leaning on @types/oracledb shapes at call sites.
interface OraConn {
  execute(
    sql: string,
    binds?: unknown,
    opts?: { autoCommit?: boolean }
  ): Promise<unknown>;
  close(): Promise<void>;
}
interface OraModule {
  getConnection(opts: {
    user: string;
    password: string;
    connectString: string;
  }): Promise<OraConn>;
}

const COLS =
  "patient_id, vorname, nachname, email, telefon_mobil, telefon_privat, geburtsdatum, geschlecht, bemerkung, modified_at";
const BINDS =
  ":id, :vn, :nn, :em, :tm, :tp, :gb, :gs, :bm, :m";

function rowBinds(p: SeedPatient): Record<string, unknown> {
  return {
    id: p.id,
    vn: p.vorname,
    nn: p.nachname,
    em: p.email,
    tm: p.telefonMobil,
    tp: p.telefonPrivat,
    gb: new Date(`${p.geburtsdatum}T00:00:00.000Z`),
    gs: p.geschlecht,
    bm: p.bemerkung,
    m: new Date(p.modifiedAt),
  };
}

runStandardHarness("Oracle (cgm-m1pro-oracle)", async () => {
  const mod = (await import("oracledb")) as unknown as OraModule & {
    default?: OraModule;
  };
  const oracledb = mod.default ?? mod;

  const container = await new GenericContainer(
    "gvenzl/oracle-free:23-slim-faststart"
  )
    .withEnvironment({
      ORACLE_PASSWORD,
      APP_USER,
      APP_USER_PASSWORD: APP_PASSWORD,
    })
    .withExposedPorts(1521)
    .withWaitStrategy(Wait.forLogMessage(/DATABASE IS READY TO USE!/))
    .withStartupTimeout(300_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(1521);
  const connectString = `${host}:${port}/${SERVICE}`;

  async function open(): Promise<OraConn> {
    return oracledb.getConnection({
      user: APP_USER,
      password: APP_PASSWORD,
      connectString,
    });
  }

  async function execIgnore(c: OraConn, sql: string, ignore: RegExp) {
    try {
      await c.execute(sql, [], { autoCommit: true });
    } catch (err) {
      if (!ignore.test(String((err as Error)?.message ?? err))) throw err;
    }
  }

  await withRetry(
    async () => {
      const c = await open();
      await c.close();
    },
    { timeoutMs: 180_000, label: "oracle connect" }
  );

  const vendor = await loadVendorConfigFile(YAML);
  const stream = vendor.streams.find((s) => s.kind === "PatientUpserted")!;

  const INSERT = `INSERT INTO patient (${COLS}) VALUES (${BINDS})`;

  const harness: EngineHarness = {
    label: "Oracle (cgm-m1pro-oracle)",
    vendor,
    smallBatchVendor: { ...vendor, batchSize: 3 },
    stream,
    newDriver: () => new OracleDriver(),
    connectionParams: () => ({
      host,
      port,
      // The OracleDriver composes host:port/<database> as the Easy Connect
      // string, so `database` carries the service name for the container.
      database: SERVICE,
      username: APP_USER,
      password: APP_PASSWORD,
      options: vendor.connection.options,
    }),
    async seedPatients(rows) {
      const c = await open();
      try {
        await execIgnore(c, "DROP TABLE patient", /ORA-00942/);
        await c.execute(
          `CREATE TABLE patient (
            patient_id NUMBER NOT NULL PRIMARY KEY,
            vorname VARCHAR2(100),
            nachname VARCHAR2(100),
            email VARCHAR2(200),
            telefon_mobil VARCHAR2(64),
            telefon_privat VARCHAR2(64),
            geburtsdatum DATE,
            geschlecht VARCHAR2(8),
            bemerkung VARCHAR2(400),
            modified_at TIMESTAMP
          )`,
          [],
          { autoCommit: true }
        );
        for (const p of rows) {
          await c.execute(INSERT, rowBinds(p), { autoCommit: true });
        }
      } finally {
        await c.close();
      }
    },
    async addPatient(row) {
      const c = await open();
      try {
        await c.execute(INSERT, rowBinds(row), { autoCommit: true });
      } finally {
        await c.close();
      }
    },
    async renameEmailColumn() {
      const c = await open();
      try {
        await c.execute("ALTER TABLE patient RENAME COLUMN email TO email_v2", [], {
          autoCommit: true,
        });
      } finally {
        await c.close();
      }
    },
  };

  return {
    harness,
    teardown: async () => {
      await container.stop();
    },
  };
});
