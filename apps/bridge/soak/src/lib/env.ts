import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Central configuration for the soak harness. Everything is overridable via
 * SOAK_* env vars, but the defaults match the local dev stack exactly
 * (docker-compose Postgres on 5432, portal dev server on 3001).
 *
 * Two clinics, deliberately:
 *
 *   Praxis A — DB-Adapter-Pfad. The agent polls a tomedo-shaped Postgres
 *              (soak_tomedo) via the tomedo-db vendor config. Revenue flows
 *              ONLY through bridge_source 'tomedo'.
 *   Praxis B — Datei-Pfad. The agent watches a GDT folder + Honorar-CSV
 *              folder. Revenue flows ONLY through bridge_source 'gdt_agent'.
 *
 * One clinic must never ship revenue through both paths: the portal's M-D6
 * billing-authority gate would (correctly) block the gdt_agent side with a
 * non-retryable 403 and the reconciliation would fail by design.
 */

const here = dirname(fileURLToPath(import.meta.url));

export const SOAK_DIR = resolve(here, "..", "..");
export const AGENT_DIR = resolve(SOAK_DIR, "..", "agent");
export const RUNTIME_DIR = join(SOAK_DIR, ".runtime");

// ---- Clinics (fixed UUIDs so setup is idempotent; zod-v4-shape compliant) --
export const CLINIC_A_ID =
  process.env.SOAK_CLINIC_A_ID ?? "a0a0a0a0-50ac-4a0a-8a0a-000000000001";
export const CLINIC_B_ID =
  process.env.SOAK_CLINIC_B_ID ?? "a0a0a0a0-50ac-4a0a-8a0a-000000000002";

// ---- Portal ---------------------------------------------------------------
export const PORTAL_URL = process.env.SOAK_PORTAL_URL ?? "http://localhost:3001";
export const PORTAL_DB_URL =
  process.env.SOAK_PORTAL_DB_URL ??
  "postgres://eins:eins_dev_password@localhost:5432/eins_portal";

// ---- Chaos proxy (agents talk to the portal ONLY through this) ------------
export const PROXY_PORT = Number(process.env.SOAK_PROXY_PORT ?? 18091);
export const PROXY_URL = `http://127.0.0.1:${PROXY_PORT}`;

// ---- Vendor DB (the fake tomedo) -----------------------------------------
export const PG_SUPER_URL =
  process.env.SOAK_PG_SUPER_URL ??
  "postgres://eins:eins_dev_password@localhost:5432/eins_portal";
export const VENDOR_DB_NAME = process.env.SOAK_VENDOR_DB ?? "soak_tomedo";
export const VENDOR_DB_URL =
  process.env.SOAK_VENDOR_DB_URL ??
  `postgres://eins:eins_dev_password@localhost:5432/${VENDOR_DB_NAME}`;
export const VENDOR_READER_USER = "soak_reader";
export const VENDOR_READER_INITIAL_PW = "soak_reader_pw_1";
export const VENDOR_DB_HOST = process.env.SOAK_VENDOR_DB_HOST ?? "localhost";
export const VENDOR_DB_PORT = Number(process.env.SOAK_VENDOR_DB_PORT ?? 5432);

// ---- Per-clinic runtime layout -------------------------------------------
export const CLINIC_A = {
  id: CLINIC_A_ID,
  name: "Soak Praxis A (DB-Pfad)",
  slug: "soak-praxis-a",
  appdata: join(RUNTIME_DIR, "clinic-a", "appdata"),
  gdtFolder: join(RUNTIME_DIR, "clinic-a", "gdt-out"),
};

export const CLINIC_B = {
  id: CLINIC_B_ID,
  name: "Soak Praxis B (Datei-Pfad)",
  slug: "soak-praxis-b",
  appdata: join(RUNTIME_DIR, "clinic-b", "appdata"),
  gdtFolder: join(RUNTIME_DIR, "clinic-b", "gdt-out"),
  csvFolder: join(RUNTIME_DIR, "clinic-b", "honorar-csv"),
  csvMappingPath: join(RUNTIME_DIR, "clinic-b", "honorar-mapping.json"),
};

// The agent stores config under %APPDATA%\EINS-Agent, so with APPDATA pointed
// at our per-clinic dirs the effective config dir is:
export const agentConfigDir = (appdata: string): string =>
  join(appdata, "EINS-Agent");

// ---- State + journals -----------------------------------------------------
export const STATE_DIR = join(RUNTIME_DIR, "state");
export const JOURNAL_DIR = join(RUNTIME_DIR, "journal");
export const LOG_DIR = join(RUNTIME_DIR, "logs");

export const PROXY_MODE_FILE = join(STATE_DIR, "proxy-mode.txt");
export const DB_PASSWORD_FILE = join(STATE_DIR, "db-password.txt");
export const DROPPER_STATE_FILE = join(STATE_DIR, "dropper-state.json");

export const CHURN_JOURNAL = join(JOURNAL_DIR, "churn.jsonl");
export const DROPPER_LEDGER = join(JOURNAL_DIR, "dropper-ledger.jsonl");
export const CHAOS_JOURNAL = join(JOURNAL_DIR, "chaos.jsonl");

export const REPORT_PATH = join(RUNTIME_DIR, "soak-report.md");

// The CSV mapping the agent is configured with at setup. Headers here MUST
// match what the dropper writes.
export const CSV_MAPPING = {
  stream: "invoices",
  columns: {
    pvsPatientId: "PatNr",
    pvsInvoiceId: "RechnungsNr",
    pvsAppointmentId: "TerminNr",
    amount: "Endbetrag",
    paidAt: "Zahldatum",
    statusColumn: "Zahlstatus",
  },
  dateFormat: "DD.MM.YYYY",
  amountUnit: "eur",
  decimalSeparator: ",",
} as const;
