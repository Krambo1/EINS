import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { FirebirdDriver } from "./drivers/firebird.js";
import {
  runStandardHarness,
  withRetry,
  type EngineHarness,
  type SeedPatient,
} from "./it-support.js";
import { loadVendorConfigFile } from "./vendor-config.js";

/**
 * Real-engine integration for the Firebird driver, exercised through the
 * bundled cgm-turbomed.yaml against a live Firebird 3.0 container. Firebird
 * backs CGM Turbomed, medatixx and Quincy; this proves all three configs'
 * shared pagination shape on a real engine. Covers the Phase 3 Date bind
 * (node-firebird binds a JS Date to TIMESTAMP), the Phase 4 keyset
 * (`SELECT FIRST (:limit) ... ORDER BY`, the parenthesised FIRST the config
 * relies on), and the per-engine schema-error classification (Firebird's
 * "Column unknown" message, which has no clean SQLSTATE). Gated behind
 * PVS_DB_IT=1.
 *
 * We connect as SYSDBA: the jacobalberty image creates the database owned by
 * SYSDBA, so SYSDBA is the user that can CREATE/DROP tables in it. We keep
 * wireEncryption on to match the config (Firebird 3 defaults WireCrypt=Enabled
 * and node-firebird negotiates it).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML = join(HERE, "configs", "cgm-turbomed.yaml");

const ISC_PASSWORD = "masterkey";
const FB_DB_FILE = "turbomed.fdb";
// Server-side path the jacobalberty image creates the database at; this is the
// path node-firebird opens over the wire, not a host path.
const DB_PATH = `/firebird/data/${FB_DB_FILE}`;

interface FbDb {
  query(
    sql: string,
    params: unknown[],
    cb: (err: Error | null, result?: unknown) => void
  ): void;
  detach(cb?: (err: Error | null) => void): void;
}
interface FbModule {
  attach(
    opts: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
      lowercase_keys?: boolean;
      wireEncryption?: boolean;
    },
    cb: (err: Error | null, db: FbDb) => void
  ): void;
}

const COLS =
  "PATIENT_ID, VORNAME, NAME, EMAIL, TELEFON_MOBIL, TELEFON, GEBURTSDATUM, GESCHLECHT, BEMERKUNG, GEAENDERT";

function rowValues(p: SeedPatient): unknown[] {
  return [
    p.id,
    p.vorname,
    p.nachname,
    p.email,
    p.telefonMobil,
    p.telefonPrivat,
    new Date(`${p.geburtsdatum}T00:00:00.000Z`),
    p.geschlecht,
    p.bemerkung,
    new Date(p.modifiedAt),
  ];
}

runStandardHarness("Firebird (cgm-turbomed)", async () => {
  const mod = (await import("node-firebird")) as unknown as FbModule & {
    default?: FbModule;
  };
  const Firebird = mod.default ?? mod;

  const container = await new GenericContainer("jacobalberty/firebird:3.0")
    .withEnvironment({
      ISC_PASSWORD,
      FIREBIRD_DATABASE: FB_DB_FILE,
      EnableLegacyClientAuth: "true",
    })
    .withExposedPorts(3050)
    .withStartupTimeout(120_000)
    // Firebird's log is sparse; the default port-listening wait plus the
    // attach retry below is the reliable readiness signal.
    .withWaitStrategy(Wait.forListeningPorts())
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(3050);

  function attach(): Promise<FbDb> {
    return new Promise((resolve, reject) => {
      Firebird.attach(
        {
          host,
          port,
          database: DB_PATH,
          user: "SYSDBA",
          password: ISC_PASSWORD,
          lowercase_keys: true,
          wireEncryption: true,
        },
        (err, db) => (err ? reject(err) : resolve(db))
      );
    });
  }

  function exec(db: FbDb, sql: string, params: unknown[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      db.query(sql, params, (err) => (err ? reject(err) : resolve()));
    });
  }

  function detach(db: FbDb): Promise<void> {
    return new Promise((resolve) => {
      try {
        db.detach(() => resolve());
      } catch {
        resolve();
      }
    });
  }

  await withRetry(
    async () => {
      const db = await attach();
      await detach(db);
    },
    { timeoutMs: 90_000, label: "firebird attach" }
  );

  const vendor = await loadVendorConfigFile(YAML);
  const stream = vendor.streams.find((s) => s.kind === "PatientUpserted")!;

  const INSERT = `INSERT INTO PATIENT (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const harness: EngineHarness = {
    label: "Firebird (cgm-turbomed)",
    vendor,
    smallBatchVendor: { ...vendor, batchSize: 3 },
    stream,
    newDriver: () => new FirebirdDriver(),
    connectionParams: () => ({
      host,
      port,
      database: DB_PATH,
      username: "SYSDBA",
      password: ISC_PASSWORD,
      options: vendor.connection.options,
    }),
    async seedPatients(rows) {
      const db = await attach();
      try {
        // Firebird 3 has no DROP TABLE IF EXISTS; a first-run drop legitimately
        // fails because the table does not exist yet, so we best-effort ignore
        // any drop error and let the following CREATE surface a real problem.
        await exec(db, "DROP TABLE PATIENT").catch(() => void 0);
        await exec(
          db,
          `CREATE TABLE PATIENT (
            PATIENT_ID INTEGER NOT NULL PRIMARY KEY,
            VORNAME VARCHAR(100),
            NAME VARCHAR(100),
            EMAIL VARCHAR(200),
            TELEFON_MOBIL VARCHAR(64),
            TELEFON VARCHAR(64),
            GEBURTSDATUM DATE,
            GESCHLECHT VARCHAR(8),
            BEMERKUNG VARCHAR(400),
            GEAENDERT TIMESTAMP NOT NULL
          )`
        );
        for (const p of rows) {
          await exec(db, INSERT, rowValues(p));
        }
      } finally {
        await detach(db);
      }
    },
    async addPatient(row) {
      const db = await attach();
      try {
        await exec(db, INSERT, rowValues(row));
      } finally {
        await detach(db);
      }
    },
    async renameEmailColumn() {
      const db = await attach();
      try {
        await exec(db, "ALTER TABLE PATIENT ALTER COLUMN EMAIL TO EMAIL_V2");
      } finally {
        await detach(db);
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
