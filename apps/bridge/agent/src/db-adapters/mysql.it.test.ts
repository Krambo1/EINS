import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { MysqlDriver } from "./drivers/mysql.js";
import {
  runStandardHarness,
  withRetry,
  type EngineHarness,
  type SeedPatient,
} from "./it-support.js";
import { loadVendorConfigFile } from "./vendor-config.js";

/**
 * Real-engine integration for the MySQL/MariaDB driver, exercised through the
 * bundled indamed.yaml against a live MariaDB container. Indamed Medical
 * Office stores its core practice data in MariaDB. Proves the Phase 3 Date
 * bind, the Phase 4 keyset, and the per-engine schema-error classification
 * end-to-end through pollOnce. Gated behind PVS_DB_IT=1; see it-support.ts.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML = join(HERE, "configs", "indamed.yaml");

const DB = "medoff";
const USER = "eins";
const PASSWORD = "eins_pw";

// Patient column list in the order the indamed PatientUpserted SELECT names
// its source columns (anmerkung -> bemerkung, geaendert_am -> modified_at).
const COLS =
  "pat_id, vorname, nachname, email, telefon_mobil, telefon_privat, geburtsdatum, geschlecht, anmerkung, geaendert_am";
const PLACEHOLDERS = "?,?,?,?,?,?,?,?,?,?";

function rowValues(p: SeedPatient): Array<string | number | Date> {
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

runStandardHarness("MySQL/MariaDB (indamed)", async () => {
  // Lazy import: mysql2 is only touched when the suite actually runs.
  const { createConnection } = await import("mysql2/promise");

  const container = await new GenericContainer("mariadb:11.4")
    .withEnvironment({
      MARIADB_ROOT_PASSWORD: "root_pw",
      MARIADB_DATABASE: DB,
      MARIADB_USER: USER,
      MARIADB_PASSWORD: PASSWORD,
    })
    .withExposedPorts(3306)
    // MariaDB logs "ready for connections" twice: once for the bootstrap
    // server during init, once for the real network server. Wait for the
    // second so we don't connect before the user/db exist.
    .withWaitStrategy(Wait.forLogMessage(/ready for connections/, 2))
    .withStartupTimeout(120_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(3306);

  // Same tz/date options the production driver uses, so a Date written here
  // and read back through MysqlDriver is the exact same instant.
  async function open() {
    return createConnection({
      host,
      port,
      user: USER,
      password: PASSWORD,
      database: DB,
      namedPlaceholders: true,
      dateStrings: false,
      timezone: "Z",
    });
  }

  await withRetry(
    async () => {
      const c = await open();
      await c.end();
    },
    { timeoutMs: 60_000, label: "mariadb connect" }
  );

  const vendor = await loadVendorConfigFile(YAML);
  const stream = vendor.streams.find((s) => s.kind === "PatientUpserted")!;

  const harness: EngineHarness = {
    label: "MySQL/MariaDB (indamed)",
    vendor,
    smallBatchVendor: { ...vendor, batchSize: 3 },
    stream,
    newDriver: () => new MysqlDriver(),
    connectionParams: () => ({
      host,
      port,
      database: DB,
      username: USER,
      password: PASSWORD,
    }),
    async seedPatients(rows) {
      const c = await open();
      try {
        await c.query("DROP TABLE IF EXISTS patient");
        await c.query(`CREATE TABLE patient (
          pat_id BIGINT NOT NULL PRIMARY KEY,
          vorname VARCHAR(100),
          nachname VARCHAR(100),
          email VARCHAR(200),
          telefon_mobil VARCHAR(64),
          telefon_privat VARCHAR(64),
          geburtsdatum DATE,
          geschlecht VARCHAR(8),
          anmerkung TEXT,
          geaendert_am DATETIME NOT NULL
        )`);
        for (const p of rows) {
          await c.execute(
            `INSERT INTO patient (${COLS}) VALUES (${PLACEHOLDERS})`,
            rowValues(p)
          );
        }
      } finally {
        await c.end();
      }
    },
    async addPatient(row) {
      const c = await open();
      try {
        await c.execute(
          `INSERT INTO patient (${COLS}) VALUES (${PLACEHOLDERS})`,
          rowValues(row)
        );
      } finally {
        await c.end();
      }
    },
    async renameEmailColumn() {
      const c = await open();
      try {
        await c.query("ALTER TABLE patient RENAME COLUMN email TO email_v2");
      } finally {
        await c.end();
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
