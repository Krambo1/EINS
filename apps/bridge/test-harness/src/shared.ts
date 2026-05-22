/**
 * Shared constants + helpers for the bridge test harness.
 *
 * The harness fakes one Praxis with a fixed clinicId + HMAC secret so every
 * driver and the stub portal can compute / verify the same signatures
 * without touching a database.
 */
import { createHmac, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * Cross-platform "is this script the entrypoint?" check.
 *
 * `import.meta.url === file://${argv[1]}` is wrong on Windows: Node returns
 * `file:///D:/path/foo.ts` (three slashes for absolute paths), but a manual
 * `file://` + path string produces two slashes. The compare silently fails
 * and the entrypoint block never runs.
 *
 * `pathToFileURL(argv[1]).href` produces the same form Node uses for the
 * import URL, so the equality holds on win32, darwin, and linux.
 */
export function isMain(metaUrl: string): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  return metaUrl === pathToFileURL(argv1).href;
}


/** Fixed clinicId used by every driver. Any UUID works — this one is just
 *  hard-coded so logs are stable across runs. */
export const TEST_CLINIC_ID = "00000000-0000-4000-8000-000000000001";

/** Per-clinic HMAC secret. In production this is decrypted from
 *  platform_credentials at startup; here we hard-code the hex string so the
 *  stub portal and the drivers agree on what to sign with. */
export const TEST_CLINIC_SECRET =
  "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

/** Where the stub portal listens. Drivers POST canonical events here. */
export const STUB_PORTAL_PORT = 7401;
export const STUB_PORTAL_URL = `http://127.0.0.1:${STUB_PORTAL_PORT}`;

/** Where the Tomedo mock listens. Tomedo client points at this. */
export const TOMEDO_MOCK_PORT = 7402;
export const TOMEDO_MOCK_URL = `http://127.0.0.1:${TOMEDO_MOCK_PORT}`;

/** Base URL of a local HAPI FHIR server, started via the harness's
 *  docker-compose.yml. Overridable via FHIR_BASE_URL for the public HAPI
 *  test server (https://hapi.fhir.org/baseR4). */
export const FHIR_BASE_URL =
  process.env.FHIR_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8090/fhir";

/** Sign a raw JSON body with the test clinic's secret, in the wire format
 *  the portal expects (matches apps/bridge/src/canonical/sign.ts). */
export function signBody(raw: string, secret = TEST_CLINIC_SECRET): string {
  const sig = createHmac("sha256", secret).update(raw).digest("hex");
  return `sha256=${sig}`;
}

/** Compact ASCII summary of an arbitrary canonical event — used in console
 *  output so a 20-event run doesn't drown the terminal. */
export function summarise(event: { kind: string; [k: string]: unknown }): string {
  const k = event.kind;
  const get = (key: string) => (event as Record<string, unknown>)[key];
  switch (k) {
    case "PatientUpserted":
      return `${k}(${get("pvsPatientId")}, ${get("fullName") ?? "—"}, ${get("email") ?? "—"})`;
    case "AppointmentCreated":
      return `${k}(${get("pvsAppointmentId")} @ ${get("scheduledAt")} ${get("treatmentLabel") ?? ""})`;
    case "AppointmentStatusChanged":
      return `${k}(${get("pvsAppointmentId")} → ${get("newStatus")})`;
    case "AppointmentCancelled":
      return `${k}(${get("pvsAppointmentId")})`;
    case "EncounterCompleted":
      return `${k}(${get("pvsEncounterId")} ${get("treatmentLabel") ?? ""})`;
    case "InvoicePaid":
      return `${k}(${get("pvsInvoiceId")} ${get("amountCents")}¢)`;
    case "RecallScheduled":
      return `${k}(${get("pvsRecallId")} @ ${get("recallAt")})`;
    case "PatientMerged":
      return `${k}(${get("fromPvsPatientId")} → ${get("toPvsPatientId")})`;
    default:
      return `${k}(?)`;
  }
}

/** Friendly section banner so a "run-all" log is easy to scan. */
export function banner(title: string): void {
  const line = "─".repeat(Math.max(0, 60 - title.length - 2));
  console.log(`\n── ${title} ${line}`);
}

/** Format a Date as ISO with millisecond precision and a trailing Z. */
export function iso(d = new Date()): string {
  return d.toISOString();
}

/** Generate a stable-ish unique id for synthetic PVS-side rows. */
export function freshId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
