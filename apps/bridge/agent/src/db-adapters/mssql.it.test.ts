import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { GenericContainer, Wait } from "testcontainers";
import { MssqlDriver } from "./drivers/mssql.js";
import {
  runStandardHarness,
  withRetry,
  type EngineHarness,
  type SeedPatient,
} from "./it-support.js";
import { loadVendorConfigFile } from "./vendor-config.js";

/**
 * Real-engine integration for the MSSQL driver, exercised through the bundled
 * cgm-m1pro.yaml against a live SQL Server container. Covers the
 * SQL-Server-flavoured CGM M1 PRO install variant. Proves the Phase 3 Date
 * bind (tedious binds a JS Date as datetime in UTC), the Phase 4 keyset
 * (`SELECT TOP (:limit) ... ORDER BY`), and the per-engine schema-error
 * classification (SQL Server error 207). Gated behind PVS_DB_IT=1.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const YAML = join(HERE, "configs", "cgm-m1pro.yaml");

// Meets SQL Server's password-complexity policy (upper, lower, digit, symbol).
const SA_PASSWORD = "Eins_Strong_Pw_123";
const DB = "M1PRO";

const COLS =
  "PatientId, Vorname, Nachname, Email, TelefonMobil, TelefonPrivat, Geburtsdatum, Geschlecht, Bemerkung, ModifiedAt";

runStandardHarness("MSSQL (cgm-m1pro)", async () => {
  const mssql = (await import("mssql")).default;

  const container = await new GenericContainer(
    "mcr.microsoft.com/mssql/server:2022-latest"
  )
    .withEnvironment({
      ACCEPT_EULA: "Y",
      MSSQL_SA_PASSWORD: SA_PASSWORD,
      MSSQL_PID: "Developer",
    })
    .withExposedPorts(1433)
    .withWaitStrategy(
      Wait.forLogMessage(/SQL Server is now ready for client connections/)
    )
    .withStartupTimeout(180_000)
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(1433);

  async function poolTo(database: string) {
    const pool = new mssql.ConnectionPool({
      user: "sa",
      password: SA_PASSWORD,
      server: host,
      port,
      database,
      options: { encrypt: true, trustServerCertificate: true },
    });
    await pool.connect();
    return pool;
  }

  // The SA login lags the "ready for connections" log line; retry until it
  // accepts a connection, then create the M1 PRO database the config targets.
  await withRetry(
    async () => {
      const pool = await poolTo("master");
      try {
        await pool
          .request()
          .query(`IF DB_ID('${DB}') IS NULL CREATE DATABASE [${DB}]`);
      } finally {
        await pool.close();
      }
    },
    { timeoutMs: 120_000, label: "mssql connect + create db" }
  );

  const vendor = await loadVendorConfigFile(YAML);
  const stream = vendor.streams.find((s) => s.kind === "PatientUpserted")!;

  function bindRow(req: ReturnType<Awaited<ReturnType<typeof poolTo>>["request"]>, p: SeedPatient) {
    return req
      .input("PatientId", mssql.Int, p.id)
      .input("Vorname", mssql.NVarChar, p.vorname)
      .input("Nachname", mssql.NVarChar, p.nachname)
      .input("Email", mssql.NVarChar, p.email)
      .input("TelefonMobil", mssql.NVarChar, p.telefonMobil)
      .input("TelefonPrivat", mssql.NVarChar, p.telefonPrivat)
      .input("Geburtsdatum", mssql.Date, new Date(`${p.geburtsdatum}T00:00:00.000Z`))
      .input("Geschlecht", mssql.NVarChar, p.geschlecht)
      .input("Bemerkung", mssql.NVarChar, p.bemerkung)
      .input("ModifiedAt", mssql.DateTime2, new Date(p.modifiedAt));
  }

  const INSERT = `INSERT INTO Patient (${COLS}) VALUES
    (@PatientId, @Vorname, @Nachname, @Email, @TelefonMobil, @TelefonPrivat,
     @Geburtsdatum, @Geschlecht, @Bemerkung, @ModifiedAt)`;

  const harness: EngineHarness = {
    label: "MSSQL (cgm-m1pro)",
    vendor,
    smallBatchVendor: { ...vendor, batchSize: 3 },
    stream,
    newDriver: () => new MssqlDriver(),
    connectionParams: () => ({
      host,
      port,
      database: DB,
      username: "sa",
      password: SA_PASSWORD,
      options: vendor.connection.options,
    }),
    async seedPatients(rows) {
      const pool = await poolTo(DB);
      try {
        await pool.request().query("DROP TABLE IF EXISTS Patient");
        await pool.request().query(`CREATE TABLE Patient (
          PatientId INT NOT NULL PRIMARY KEY,
          Vorname NVARCHAR(100),
          Nachname NVARCHAR(100),
          Email NVARCHAR(200),
          TelefonMobil NVARCHAR(64),
          TelefonPrivat NVARCHAR(64),
          Geburtsdatum DATE,
          Geschlecht NVARCHAR(8),
          Bemerkung NVARCHAR(400),
          ModifiedAt DATETIME2 NOT NULL
        )`);
        for (const p of rows) {
          await bindRow(pool.request(), p).query(INSERT);
        }
      } finally {
        await pool.close();
      }
    },
    async addPatient(row) {
      const pool = await poolTo(DB);
      try {
        await bindRow(pool.request(), row).query(INSERT);
      } finally {
        await pool.close();
      }
    },
    async renameEmailColumn() {
      const pool = await poolTo(DB);
      try {
        await pool
          .request()
          .query("EXEC sp_rename 'Patient.Email', 'EmailV2', 'COLUMN'");
      } finally {
        await pool.close();
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
