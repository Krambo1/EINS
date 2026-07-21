import { randomBytes, createHash } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CLINIC_A,
  CLINIC_B,
  CSV_MAPPING,
  DB_PASSWORD_FILE,
  LOG_DIR,
  PG_SUPER_URL,
  PORTAL_DB_URL,
  PORTAL_URL,
  PROXY_URL,
  RUNTIME_DIR,
  STATE_DIR,
  JOURNAL_DIR,
  VENDOR_DB_NAME,
  VENDOR_DB_HOST,
  VENDOR_DB_PORT,
  VENDOR_DB_URL,
  VENDOR_READER_INITIAL_PW,
  VENDOR_READER_USER,
  agentConfigDir,
} from "./lib/env.js";
import { query, withClient } from "./lib/pg.js";
import { ensureDir, log, warn, writeJsonFile, readJsonFile } from "./lib/util.js";
import { runAgentOnce } from "./lib/proc.js";
import { proxyAlreadyRunning, startProxy, type ProxyHandle } from "./proxy.js";
import {
  readAgentConfig,
  writeAgentConfig,
  writeDbCredential,
} from "./lib/agent-bridge.js";

/**
 * Idempotent soak setup. Safe to re-run; `--reset` tears everything down
 * first (portal rows, vendor DB, runtime dir incl. agent enrollments).
 *
 * Prerequisites (see README): docker Postgres up (pnpm db:up, migrations
 * applied) and the portal dev server running on PORTAL_URL.
 */

const TAG = "setup";

// ---------------------------------------------------------------------------
// Vendor schema — matches tomedo.yaml column-for-column. The drift detector
// halts any stream whose first poll sees different columns, so this MUST stay
// in sync with apps/bridge/agent/src/db-adapters/configs/tomedo.yaml.
// ---------------------------------------------------------------------------
const VENDOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS patient (
  id             BIGSERIAL PRIMARY KEY,
  vorname        TEXT NOT NULL,
  nachname       TEXT NOT NULL,
  email          TEXT,
  telefon_mobil  TEXT,
  telefon_privat TEXT,
  geburtsdatum   DATE,
  geschlecht     TEXT,
  bemerkung      TEXT,
  modified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS patient_modified_idx ON patient (modified_at, id);

CREATE TABLE IF NOT EXISTS termin (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES patient(id),
  termin_zeit     TIMESTAMPTZ NOT NULL,
  behandlung_code TEXT,
  behandlung_name TEXT,
  raum_id         BIGINT,
  raum_name       TEXT,
  kommentar       TEXT,
  status          TEXT,
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS termin_modified_idx ON termin (modified_at, id);

CREATE TABLE IF NOT EXISTS behandlung (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES patient(id),
  termin_id       BIGINT REFERENCES termin(id),
  behandlung_zeit TIMESTAMPTZ NOT NULL,
  behandlung_code TEXT,
  behandlung_name TEXT,
  behandler_name  TEXT,
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS behandlung_modified_idx ON behandlung (modified_at, id);

CREATE TABLE IF NOT EXISTS rechnung (
  id            BIGSERIAL PRIMARY KEY,
  patient_id    BIGINT NOT NULL REFERENCES patient(id),
  termin_id     BIGINT REFERENCES termin(id),
  behandlung_id BIGINT REFERENCES behandlung(id),
  betrag        NUMERIC(10,2) NOT NULL,
  bezahlt_am    TIMESTAMPTZ,
  status        TEXT NOT NULL,
  modified_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rechnung_modified_idx ON rechnung (modified_at, id);

CREATE TABLE IF NOT EXISTS recall (
  id              BIGSERIAL PRIMARY KEY,
  patient_id      BIGINT NOT NULL REFERENCES patient(id),
  recall_zeit     TIMESTAMPTZ NOT NULL,
  behandlung_code TEXT,
  behandlung_name TEXT,
  modified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recall_modified_idx ON recall (modified_at, id);
`;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function reset(): Promise<void> {
  log(TAG, "RESET: wiping soak clinics, vendor DB, runtime dir");
  // Portal side. pvs_event_log has no clinic FK (partitioned) → manual.
  try {
    await query(PORTAL_DB_URL, `DELETE FROM pvs_event_log WHERE clinic_id IN ($1, $2)`, [
      CLINIC_A.id,
      CLINIC_B.id,
    ]);
    // Not every FK to clinics is ON DELETE CASCADE (platform_credentials, kpi_daily,
    // requests, ... are NO ACTION). Discover them instead of hardcoding a list that
    // rots with the next migration, and clear them before the clinics themselves.
    const refsRes = await query(
      PORTAL_DB_URL,
      `SELECT c.conrelid::regclass::text AS child, a.attname AS col
         FROM pg_constraint c
         JOIN pg_class p ON p.oid = c.confrelid
         JOIN unnest(c.conkey) AS k(attnum) ON true
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.contype = 'f' AND p.relname = 'clinics' AND c.confdeltype <> 'c'`
    );
    const refs = refsRes.rows as Array<{ child: string; col: string }>;
    for (const ref of refs) {
      await query(PORTAL_DB_URL, `DELETE FROM ${ref.child} WHERE ${ref.col} IN ($1, $2)`, [
        CLINIC_A.id,
        CLINIC_B.id,
      ]);
    }
    await query(PORTAL_DB_URL, `DELETE FROM clinics WHERE id IN ($1, $2)`, [
      CLINIC_A.id,
      CLINIC_B.id,
    ]);
    log(
      TAG,
      `portal rows deleted (event_log + ${refs.length} non-cascading child tables + clinics cascade)`
    );
  } catch (err) {
    warn(TAG, `portal cleanup failed (is Postgres up?): ${(err as Error).message}`);
  }
  // Vendor DB.
  try {
    await query(PG_SUPER_URL, `DROP DATABASE IF EXISTS ${VENDOR_DB_NAME} WITH (FORCE)`);
    await query(PG_SUPER_URL, `DROP ROLE IF EXISTS ${VENDOR_READER_USER}`);
    log(TAG, `dropped ${VENDOR_DB_NAME} + role ${VENDOR_READER_USER}`);
  } catch (err) {
    warn(TAG, `vendor DB cleanup failed: ${(err as Error).message}`);
  }
  // Runtime (agent enrollments, outboxes, journals, ledgers).
  rmSync(RUNTIME_DIR, { recursive: true, force: true });
  log(TAG, `${RUNTIME_DIR} removed`);
}

async function ensurePortalReachable(): Promise<void> {
  try {
    const res = await fetch(PORTAL_URL, { redirect: "manual" });
    log(TAG, `portal reachable at ${PORTAL_URL} (HTTP ${res.status})`);
  } catch {
    throw new Error(
      `portal not reachable at ${PORTAL_URL}. Start it first: pnpm dev:portal (and pnpm db:up + pnpm db:migrate).`
    );
  }
}

async function ensureClinics(): Promise<void> {
  for (const c of [CLINIC_A, CLINIC_B]) {
    await query(
      PORTAL_DB_URL,
      `INSERT INTO clinics (id, legal_name, display_name, slug)
       VALUES ($1, $2, $2, $3)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.name, c.slug]
    );
  }
  log(TAG, `clinics ensured: A=${CLINIC_A.id} B=${CLINIC_B.id}`);
}

async function ensureVendorDb(): Promise<string> {
  const exists = await query(
    PG_SUPER_URL,
    `SELECT 1 FROM pg_database WHERE datname = $1`,
    [VENDOR_DB_NAME]
  );
  if (exists.rowCount === 0) {
    await query(PG_SUPER_URL, `CREATE DATABASE ${VENDOR_DB_NAME}`);
    log(TAG, `created database ${VENDOR_DB_NAME}`);
  }
  await withClient(VENDOR_DB_URL, async (c) => {
    await c.query(VENDOR_SCHEMA_SQL);
  });
  log(TAG, "vendor schema ensured (patient/termin/behandlung/rechnung/recall)");

  // Read-only login role for the agent, like the account Zollsoft provisions.
  // Current password persists in the state file so chaos rotations and
  // re-runs stay consistent.
  const password = readJsonFile<{ password: string }>(DB_PASSWORD_FILE, {
    password: VENDOR_READER_INITIAL_PW,
  }).password;
  const role = await query(PG_SUPER_URL, `SELECT 1 FROM pg_roles WHERE rolname = $1`, [
    VENDOR_READER_USER,
  ]);
  if (role.rowCount === 0) {
    await query(
      PG_SUPER_URL,
      `CREATE ROLE ${VENDOR_READER_USER} LOGIN PASSWORD '${password}'`
    );
  } else {
    await query(
      PG_SUPER_URL,
      `ALTER ROLE ${VENDOR_READER_USER} WITH LOGIN PASSWORD '${password}'`
    );
  }
  await withClient(VENDOR_DB_URL, async (c) => {
    await c.query(`GRANT CONNECT ON DATABASE ${VENDOR_DB_NAME} TO ${VENDOR_READER_USER}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${VENDOR_READER_USER}`);
    await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${VENDOR_READER_USER}`);
    await c.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${VENDOR_READER_USER}`
    );
  });
  writeJsonFile(DB_PASSWORD_FILE, { password });
  log(TAG, `read-only role ${VENDOR_READER_USER} ensured`);
  return password;
}

async function mintEnrollmentToken(clinicId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await query(
    PORTAL_DB_URL,
    `INSERT INTO pvs_agent_enrollment_tokens
       (clinic_id, token_hash, created_by, expires_at, allow_vendor_switch)
     VALUES ($1, $2, NULL, now() + interval '24 hours', true)`,
    [clinicId, sha256Hex(token)]
  );
  return token;
}

async function enrollClinicA(): Promise<void> {
  if (existsSync(join(agentConfigDir(CLINIC_A.appdata), "config.json"))) {
    log(TAG, "Praxis A already enrolled — skipping");
    return;
  }
  ensureDir(CLINIC_A.gdtFolder);
  const token = await mintEnrollmentToken(CLINIC_A.id);
  const code = await runAgentOnce({
    appdata: CLINIC_A.appdata,
    logFile: join(LOG_DIR, "agent-a.log"),
    stdinData: token + "\n",
    args: [
      "--enroll",
      "--token-stdin",
      "--clinic",
      CLINIC_A.id,
      "--portal",
      PROXY_URL,
      "--allow-insecure-dev",
      "--folder",
      CLINIC_A.gdtFolder,
    ],
  });
  if (code !== 0 || !existsSync(join(agentConfigDir(CLINIC_A.appdata), "config.json"))) {
    throw new Error(
      `enrollment for Praxis A failed (exit ${code}) — see .runtime/logs/agent-a.log`
    );
  }
  log(TAG, "Praxis A enrolled (gdt_agent)");
}

async function enrollClinicB(): Promise<void> {
  if (existsSync(join(agentConfigDir(CLINIC_B.appdata), "config.json"))) {
    log(TAG, "Praxis B already enrolled — skipping");
    return;
  }
  ensureDir(CLINIC_B.gdtFolder);
  ensureDir(CLINIC_B.csvFolder);
  writeFileSync(CLINIC_B.csvMappingPath, JSON.stringify(CSV_MAPPING, null, 2), "utf8");
  const token = await mintEnrollmentToken(CLINIC_B.id);
  const code = await runAgentOnce({
    appdata: CLINIC_B.appdata,
    logFile: join(LOG_DIR, "agent-b.log"),
    stdinData: token + "\n",
    args: [
      "--enroll",
      "--token-stdin",
      "--clinic",
      CLINIC_B.id,
      "--portal",
      PROXY_URL,
      "--allow-insecure-dev",
      "--folder",
      CLINIC_B.gdtFolder,
      "--honorar-folder",
      CLINIC_B.csvFolder,
      "--honorar-mapping",
      CLINIC_B.csvMappingPath,
    ],
  });
  if (code !== 0 || !existsSync(join(agentConfigDir(CLINIC_B.appdata), "config.json"))) {
    throw new Error(
      `enrollment for Praxis B failed (exit ${code}) — see .runtime/logs/agent-b.log`
    );
  }
  log(TAG, "Praxis B enrolled (gdt_agent + Honorar-CSV)");
}

async function enableDbAdapterForA(password: string): Promise<void> {
  const cfg = await readAgentConfig(CLINIC_A.appdata);
  if (!cfg) throw new Error("Praxis A config missing after enrollment");
  await writeDbCredential(CLINIC_A.appdata, "tomedo-db-default", password);
  const enrollment = {
    vendor: "tomedo-db",
    credentialId: "tomedo-db-default",
    host: VENDOR_DB_HOST,
    port: VENDOR_DB_PORT,
    database: VENDOR_DB_NAME,
    username: VENDOR_READER_USER,
  };
  cfg.dbAdapters = [enrollment];
  await writeAgentConfig(CLINIC_A.appdata, cfg);
  log(TAG, "Praxis A: tomedo-db adapter enabled (credential in DPAPI store)");
}

async function seedLinkSourceForA(): Promise<void> {
  // The heartbeat would seed this within ~60s anyway (and 409s are retryable
  // meanwhile); pre-seeding just removes the startup noise.
  await query(
    PORTAL_DB_URL,
    `INSERT INTO pvs_link_source (clinic_id, bridge_source, pvs_vendor, enrolled_via)
     VALUES ($1, 'tomedo', 'tomedo', 'heartbeat')
     ON CONFLICT (clinic_id, bridge_source) DO NOTHING`,
    [CLINIC_A.id]
  );
  log(TAG, "Praxis A: pvs_link_source 'tomedo' pre-seeded");
}

async function main(): Promise<void> {
  const doReset = process.argv.includes("--reset");
  if (doReset) {
    await reset();
    if (!process.argv.includes("--and-setup")) {
      log(TAG, "reset done. Run `pnpm --filter eins-bridge-soak setup` to rebuild.");
      return;
    }
  }

  for (const d of [RUNTIME_DIR, STATE_DIR, JOURNAL_DIR, LOG_DIR]) ensureDir(d);
  await ensurePortalReachable();
  await ensureClinics();
  const dbPassword = await ensureVendorDb();

  // Enrollment goes through the chaos proxy so the persisted portalBaseUrl
  // points at the proxy for the whole soak. Start one if none is running.
  let ephemeral: ProxyHandle | null = null;
  if (!(await proxyAlreadyRunning())) {
    ephemeral = await startProxy();
  }
  try {
    await enrollClinicA();
    await enrollClinicB();
  } finally {
    await ephemeral?.close();
  }

  await enableDbAdapterForA(dbPassword);
  await seedLinkSourceForA();

  log(TAG, "");
  log(TAG, "Setup complete.");
  log(TAG, `  Praxis A (DB-Pfad):    clinic ${CLINIC_A.id}`);
  log(TAG, `  Praxis B (Datei-Pfad): clinic ${CLINIC_B.id}`);
  log(TAG, "Next: pnpm --filter eins-bridge-soak smoke   (8-minute proof run)");
  log(TAG, "      pnpm --filter eins-bridge-soak soak -- --hours 48");
}

main().catch((err) => {
  console.error(`[${TAG}] FATAL:`, err);
  process.exit(1);
});
