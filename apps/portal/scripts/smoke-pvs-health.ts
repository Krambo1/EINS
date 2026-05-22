/**
 * HTTP smoke test for Phase 4 PVS health surface.
 *
 * Verifies against the running dev server at :3001:
 *   - POST /api/pvs/health accepts a fresh signed schema_drift event
 *     and returns 201 (inserted).
 *   - Replaying the same envelope returns 201 (deduped).
 *   - Sending schema_recovered marks the matching open row resolved.
 *   - A bad signature returns 400.
 *
 * Direct DB queries (listUnresolvedHealth, etc.) are tested via psql in
 * the parent session and via Vitest in src/server/pvs-health.test.ts.
 *
 * Prereq: a clinic exists with id CLINIC_ID and a 'pvs' platform_credentials
 * row whose decrypted plaintext is exported below in SECRET_HEX. Mint via
 * the portal's enrollment flow or the `mintAndStorePvsSecret` helper.
 */

import { createHmac } from "node:crypto";

const CLINIC_ID = process.env.CLINIC_ID ?? "c7d88b71-72da-4920-b939-5158b13d3449";
const PORTAL_URL = process.env.PORTAL_URL ?? "http://localhost:3001";
const SECRET_HEX = process.env.PVS_SECRET ?? "";

const VENDOR = "tomedo-db";

function red(s: string): string {
  return `\x1b[31m${s}\x1b[0m`;
}
function green(s: string): string {
  return `\x1b[32m${s}\x1b[0m`;
}

let failed = 0;
function check(label: string, ok: boolean, extra?: string): void {
  if (ok) {
    console.log(green(`✓ ${label}`));
  } else {
    failed++;
    console.log(red(`✗ ${label}${extra ? ` :: ${extra}` : ""}`));
  }
}

function sign(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function post(
  secret: string,
  payload: unknown
): Promise<{ status: number; body: unknown }> {
  const raw = JSON.stringify(payload);
  const res = await fetch(`${PORTAL_URL}/api/pvs/health`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sign(secret, raw),
    },
    body: raw,
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function main(): Promise<void> {
  if (!SECRET_HEX) {
    console.error(
      "PVS_SECRET env not set. Mint a clinic 'pvs' secret first; the smoke needs the plaintext."
    );
    process.exit(2);
  }

  console.log("Phase 4 PVS health HTTP smoke");
  console.log("-----------------------------");

  const detected1 = "2026-05-21T13:00:00+00:00";

  const post1 = await post(SECRET_HEX, {
    clinicId: CLINIC_ID,
    pvsVendor: VENDOR,
    bridgeSource: "tomedo",
    streamKind: "EncounterCompleted",
    eventKind: "schema_drift",
    severity: "warn",
    message: "Smoke: schema-drift",
    detail: {
      expected: ["id", "appointment_id"],
      observed: ["id", "termin_id"],
      missing: ["appointment_id"],
      added: ["termin_id"],
    },
    detectedAt: detected1,
  });
  check(
    "first POST schema_drift returns 201 inserted",
    post1.status === 201 &&
      (post1.body as { status?: string }).status === "inserted",
    `got ${post1.status} ${JSON.stringify(post1.body)}`
  );

  const post2 = await post(SECRET_HEX, {
    clinicId: CLINIC_ID,
    pvsVendor: VENDOR,
    bridgeSource: "tomedo",
    streamKind: "EncounterCompleted",
    eventKind: "schema_drift",
    severity: "warn",
    message: "Smoke: schema-drift retry",
    detail: {
      expected: ["id", "appointment_id"],
      observed: ["id", "termin_id"],
      missing: ["appointment_id"],
      added: ["termin_id"],
    },
    detectedAt: detected1,
  });
  check(
    "second POST same envelope returns 201 deduped",
    post2.status === 201 &&
      (post2.body as { status?: string }).status === "deduped",
    `got ${post2.status} ${JSON.stringify(post2.body)}`
  );

  const post3 = await post(SECRET_HEX, {
    clinicId: CLINIC_ID,
    pvsVendor: VENDOR,
    bridgeSource: "tomedo",
    streamKind: "EncounterCompleted",
    eventKind: "schema_recovered",
    severity: "info",
    message: "Smoke: column shape restored",
    detail: {},
    detectedAt: "2026-05-21T13:05:00+00:00",
  });
  check(
    "schema_recovered POST returns 201 resolved",
    post3.status === 201 &&
      (post3.body as { status?: string }).status === "resolved",
    `got ${post3.status} ${JSON.stringify(post3.body)}`
  );

  // Bad signature returns generic 400.
  const raw = JSON.stringify({
    clinicId: CLINIC_ID,
    pvsVendor: VENDOR,
    bridgeSource: "tomedo",
    streamKind: "AppointmentCreated",
    eventKind: "schema_drift",
    severity: "warn",
    message: "should fail",
    detail: {},
    detectedAt: "2026-05-21T14:00:00+00:00",
  });
  const badRes = await fetch(`${PORTAL_URL}/api/pvs/health`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": "sha256=" + "0".repeat(64),
    },
    body: raw,
  });
  check(
    "bad signature returns 400 (generic invalid_request)",
    badRes.status === 400,
    `got ${badRes.status}`
  );

  console.log("-----------------------------");
  if (failed === 0) {
    console.log(green(`All HTTP checks passed.`));
    process.exit(0);
  } else {
    console.log(red(`${failed} check(s) failed.`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
