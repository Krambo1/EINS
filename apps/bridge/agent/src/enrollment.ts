import { hostname, networkInterfaces } from "node:os";
import { createHash } from "node:crypto";
import { saveConfig, type AgentConfig } from "./config.js";
import { storeSecret } from "./secure-store.js";
import type { CsvMapping } from "./csv-mapper.js";

/**
 * One-shot enrollment flow:
 *   1. Generate a stable machine fingerprint (hostname + first MAC).
 *   2. POST /api/pvs/agent-enroll with the user-provided token.
 *   3. On success, persist config.json + store secret in DPAPI/Keychain.
 *
 * Called from `eins-agent --enroll <token>` on the installer's first run.
 */

export interface EnrollInput {
  clinicId: string;
  token: string;
  portalBaseUrl: string;
  watchFolder: string;
  honorarCsvFolder?: string;
  honorarCsvMapping?: CsvMapping;
}

export interface EnrollResult {
  ok: boolean;
  error?: string;
}

export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  const fingerprint = machineFingerprint();
  const res = await fetch(
    `${input.portalBaseUrl.replace(/\/$/, "")}/api/pvs/agent-enroll`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clinicId: input.clinicId,
        token: input.token,
        machineFingerprint: fingerprint,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: `portal ${res.status}: ${(body as { error?: { code?: string } }).error?.code ?? "unknown"}`,
    };
  }
  const data = (await res.json()) as {
    pvsSecretHex: string;
    vendor: string;
    endpoint: string;
  };
  await storeSecret(data.pvsSecretHex);
  const config: AgentConfig = {
    clinicId: input.clinicId,
    portalBaseUrl: input.portalBaseUrl,
    watchFolder: input.watchFolder,
    machineFingerprint: fingerprint,
    honorarCsvFolder: input.honorarCsvFolder,
    honorarCsvMapping: input.honorarCsvMapping,
  };
  await saveConfig(config);
  return { ok: true };
}

export function machineFingerprint(): string {
  const host = hostname();
  const ifaces = networkInterfaces();
  let firstMac = "";
  outer: for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (!iface.internal && iface.mac && iface.mac !== "00:00:00:00:00:00") {
        firstMac = iface.mac;
        break outer;
      }
    }
  }
  const platform = process.platform;
  return createHash("sha256")
    .update(`${host}|${firstMac}|${platform}`)
    .digest("hex")
    .slice(0, 24);
}
