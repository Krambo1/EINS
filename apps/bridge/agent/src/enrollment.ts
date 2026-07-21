import { hostname, networkInterfaces } from "node:os";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, unlink, chmod } from "node:fs/promises";
import { join } from "node:path";
import {
  saveConfig,
  loadConfig,
  configDir,
  type AgentConfig,
} from "./config.js";
import { storeSecret } from "./secure-store.js";
import { agentFetch, tlsHint } from "./net-setup.js";
import { portalEndpoint } from "./portal-url.js";
import type { CsvMapping } from "./csv-mapper.js";

/**
 * One-shot enrollment flow:
 *   1. Compute a stable machine fingerprint (deterministic; see L19) or reuse
 *      the one persisted at the first enrollment.
 *   2. POST /api/pvs/agent-enroll with the user-provided token (bounded by a
 *      hard timeout so the installer can never hang on a held socket, L15).
 *   3. Validate the response shape BEFORE any side effect (L17).
 *   4. Journal the redemption to a recovery file, then persist secret + config
 *      idempotently so a crash after the one-time token is spent is
 *      recoverable without a new token (L16).
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

/**
 * L15: bounded enrollment request. The installer must never hang on a portal
 * that accepts the TCP connection but never responds; 30s matches
 * portal-client's event-POST timeout budget.
 */
const ENROLL_TIMEOUT_MS = 30_000;

/** L16: crash-recovery journal for a partially-completed enrollment. */
const ENROLL_RECOVERY_FILENAME = "enroll-recovery.json";

/** The portal mints the per-clinic HMAC secret as randomBytes(32) hex → 64
 *  lowercase hex chars. Validated up front so a garbled body can never reach
 *  DPAPI/Keychain as a TypeError (L17). */
const PVS_SECRET_RE = /^[0-9a-f]{64}$/i;

/** Loose UUID shape check for the operator-supplied --clinic value (L17). */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * L16: everything needed to finish enrollment locally after the portal has
 * spent the one-time token. Written to disk (0600, transiently) the instant
 * the response is validated, so a crash before the secret reaches secure-store
 * and config.json is landed can be completed on the next start.
 */
interface EnrollRecovery {
  clinicId: string;
  portalBaseUrl: string;
  watchFolder: string;
  honorarCsvFolder?: string;
  honorarCsvMapping?: CsvMapping;
  machineFingerprint: string;
  pvsSecretHex: string;
  vendor: string;
  endpoint: string;
  redeemedAt: number;
}

function recoveryPath(): string {
  return join(configDir(), ENROLL_RECOVERY_FILENAME);
}

export async function enroll(input: EnrollInput): Promise<EnrollResult> {
  // L17: reject a mistyped clinic id up front with an operator-readable error,
  // before spending a network round-trip or the one-time token.
  if (!UUID_RE.test(input.clinicId)) {
    return {
      ok: false,
      error:
        `clinic id '${input.clinicId}' is not a valid UUID; check the --clinic ` +
        `value in the portal install command.`,
    };
  }

  // L19: reuse the fingerprint captured at the FIRST enrollment when a config
  // already exists (re-install / secret rotation), so a later dock or VPN
  // adapter change cannot drift the fingerprint into an opaque portal 401. A
  // fresh install computes a deterministic one.
  const existing = await loadConfig().catch(() => null);
  const fingerprint = existing?.machineFingerprint ?? machineFingerprint();

  // L15: hard timeout on the only request that previously had none.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ENROLL_TIMEOUT_MS);
  let res: Response;
  try {
    res = await agentFetch(
      portalEndpoint(input.portalBaseUrl, "/api/pvs/agent-enroll"),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clinicId: input.clinicId,
          token: input.token,
          machineFingerprint: fingerprint,
        }),
        signal: controller.signal,
      }
    );
  } catch (err) {
    // L15: distinguish our own timeout from a generic connection failure so the
    // operator knows whether the portal was unreachable or merely slow. The
    // token is untouched in both cases (nothing was redeemed), so a retry is
    // safe.
    const aborted =
      (err as { name?: string }).name === "AbortError" ||
      controller.signal.aborted;
    if (aborted) {
      return {
        ok: false,
        error:
          `enrollment timed out after ${ENROLL_TIMEOUT_MS / 1000}s reaching ` +
          `${input.portalBaseUrl}. The portal accepted the connection but did ` +
          `not respond; check network / proxy reachability and retry (the ` +
          `token is still unused).`,
      };
    }
    // H12: enrollment used to throw an unhandled network error (bare stack
    // trace, no guidance) behind a proxy or TLS-inspecting firewall. Return a
    // structured error, and when the cause is a certificate-verification
    // failure, tell the operator exactly how to fix it (NODE_EXTRA_CA_CERTS).
    const hint = tlsHint(err);
    const base = `network error reaching ${input.portalBaseUrl}: ${(err as Error).message}`;
    return {
      ok: false,
      error: hint
        ? `${base}. ${hint}`
        : `${base}. If this Praxis is behind a corporate proxy, set HTTP_PROXY / HTTPS_PROXY; ` +
          `if behind TLS inspection, set NODE_EXTRA_CA_CERTS to the corporate root CA and retry.`,
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return {
      ok: false,
      error: `portal ${res.status}: ${(body as { error?: { code?: string } }).error?.code ?? "unknown"}`,
    };
  }

  // L17: validate the response shape BEFORE any side effect (secret store /
  // config write). A captive-portal HTML page or a proxy error page returns a
  // 200 with the wrong content-type; a partial/garbled body has no valid
  // pvsSecretHex. Both used to crash deep in DPAPI with an inscrutable
  // TypeError; here we turn them into operator-readable messages and, since no
  // side effect has run, the token-side stays exactly as the portal left it.
  const parsed = await parseEnrollResponse(res);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const data = parsed.data;

  // L16: from here the token is SPENT server-side. Journal the full redemption
  // response (including the secret) FIRST, so a crash before the secret reaches
  // secure-store / config.json lands is recoverable on the next start WITHOUT a
  // new token. The journal is 0600 and deleted the moment local persistence
  // completes, so the plaintext secret is on disk only transiently.
  const recovery: EnrollRecovery = {
    clinicId: input.clinicId,
    portalBaseUrl: input.portalBaseUrl,
    watchFolder: input.watchFolder,
    honorarCsvFolder: input.honorarCsvFolder,
    honorarCsvMapping: input.honorarCsvMapping,
    machineFingerprint: fingerprint,
    pvsSecretHex: data.pvsSecretHex,
    vendor: data.vendor,
    endpoint: data.endpoint,
    redeemedAt: Date.now(),
  };
  try {
    await writeRecoveryFile(recovery);
  } catch (err) {
    return {
      ok: false,
      error:
        `enrollment succeeded at the portal but the local recovery journal ` +
        `could not be written (${(err as Error).message}). The token is spent; ` +
        `do NOT re-enroll. Fix the config directory permissions, then restart ` +
        `the agent to retry local persistence.`,
    };
  }

  try {
    await finalizeEnrollment(recovery);
  } catch (err) {
    return {
      ok: false,
      error:
        `enrollment redeemed but local persistence failed: ${(err as Error).message}. ` +
        `The token is spent; do NOT re-enroll. Restart the agent to complete ` +
        `enrollment automatically from the recovery journal at ${recoveryPath()}.`,
    };
  }
  return { ok: true };
}

type ParseResult =
  | {
      ok: true;
      data: { pvsSecretHex: string; vendor: string; endpoint: string };
    }
  | { ok: false; error: string };

/**
 * L17: content-type + JSON + required-field validation for the enroll
 * response, all with operator-readable errors and no side effects.
 */
async function parseEnrollResponse(res: Response): Promise<ParseResult> {
  const contentType = res.headers.get("content-type") ?? "";
  const rawText = await res.text().catch(() => "");
  if (!/application\/json/i.test(contentType)) {
    return {
      ok: false,
      error:
        `portal returned a non-JSON response (content-type: ` +
        `'${contentType || "none"}'). This usually means a captive portal, a ` +
        `proxy sign-in page, or a wrong portal URL intercepted the request. ` +
        `Open the portal URL in a browser, complete any sign-in, then retry.`,
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    return {
      ok: false,
      error:
        `portal returned a malformed JSON body; cannot complete enrollment. ` +
        `Retry, and if it persists verify the portal URL.`,
    };
  }
  const obj = (json ?? {}) as Record<string, unknown>;
  const pvsSecretHex = obj.pvsSecretHex;
  if (typeof pvsSecretHex !== "string" || !PVS_SECRET_RE.test(pvsSecretHex)) {
    return {
      ok: false,
      error:
        `portal response is missing a valid pvsSecretHex (expected 64 hex ` +
        `chars); cannot complete enrollment. Re-issue the enrollment from the ` +
        `portal and retry.`,
    };
  }
  const vendor =
    typeof obj.vendor === "string" && obj.vendor ? obj.vendor : "gdt_agent";
  const endpoint =
    typeof obj.endpoint === "string" && obj.endpoint
      ? obj.endpoint
      : "/api/pvs/events";
  return { ok: true, data: { pvsSecretHex, vendor, endpoint } };
}

/**
 * L16: land the enrollment locally in a crash-safe order. Load-bearing
 * sequence:
 *   1. secret into secure-store (durable + encrypted at rest),
 *   2. config.json via the atomic tmp+rename in saveConfig,
 *   3. delete the plaintext recovery journal.
 * A crash between any two steps leaves the journal on disk, so the next start
 * re-runs this idempotently (storeSecret + saveConfig both overwrite).
 */
async function finalizeEnrollment(rec: EnrollRecovery): Promise<void> {
  await storeSecret(rec.pvsSecretHex);
  const config: AgentConfig = {
    clinicId: rec.clinicId,
    portalBaseUrl: rec.portalBaseUrl,
    watchFolder: rec.watchFolder,
    machineFingerprint: rec.machineFingerprint,
    honorarCsvFolder: rec.honorarCsvFolder,
    honorarCsvMapping: rec.honorarCsvMapping,
  };
  await saveConfig(config);
  await unlink(recoveryPath()).catch(() => {});
}

async function writeRecoveryFile(rec: EnrollRecovery): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  const target = recoveryPath();
  const tmp = join(dir, `${ENROLL_RECOVERY_FILENAME}.tmp-${process.pid}`);
  // mode 0600 on creation (POSIX). A no-op on Windows, where DPAPI + NTFS ACLs
  // govern the config dir, but the journal is deleted within milliseconds on
  // the happy path so the plaintext secret's window on disk is minimal.
  await writeFile(tmp, JSON.stringify(rec), { encoding: "utf8", mode: 0o600 });
  await chmod(tmp, 0o600).catch(() => {});
  try {
    await rename(tmp, target);
  } catch {
    // Windows can refuse a rename-over-existing if the target is briefly
    // locked; fall back to unlink + rename.
    await unlink(target).catch(() => {});
    await rename(tmp, target);
  }
}

/**
 * L16: on startup, finish an enrollment that crashed after the portal spent the
 * one-time token but before the secret + config were durably persisted
 * locally. Returns the recovered enrollment (for logging) or null when there is
 * nothing to recover. Throws on a corrupt/incomplete journal so the caller can
 * surface it loudly rather than boot half-enrolled.
 */
export async function completePendingEnrollment(): Promise<EnrollRecovery | null> {
  let raw: string;
  try {
    raw = await readFile(recoveryPath(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `enrollment recovery journal at ${recoveryPath()} exists but could not ` +
        `be read: ${(err as Error).message}`
    );
  }
  let rec: EnrollRecovery;
  try {
    rec = JSON.parse(raw) as EnrollRecovery;
  } catch {
    throw new Error(
      `enrollment recovery journal at ${recoveryPath()} is corrupt (invalid ` +
        `JSON). Do NOT re-enroll unless you are issuing a fresh token; restore ` +
        `the journal from a backup or contact support.`
    );
  }
  if (
    !rec ||
    typeof rec.clinicId !== "string" ||
    typeof rec.pvsSecretHex !== "string" ||
    !PVS_SECRET_RE.test(rec.pvsSecretHex) ||
    typeof rec.machineFingerprint !== "string"
  ) {
    throw new Error(
      `enrollment recovery journal at ${recoveryPath()} is missing required ` +
        `fields; cannot complete enrollment safely.`
    );
  }
  await finalizeEnrollment(rec);
  return rec;
}

/**
 * L19: adapter-name patterns for virtual / VPN / container / tunnelling
 * interfaces whose MAC churns as docks connect, VPNs toggle, or WSL/Docker
 * start. Skipping them keeps the fingerprint pinned to the machine's real
 * NIC(s). Matched case-insensitively against the OS interface name.
 */
const VIRTUAL_IFACE_RE =
  /vpn|virtual|vmware|vbox|virtualbox|hyper-?v|vethernet|veth|docker|\bbr-|tunnel|tap-?windows|\btap\d|\btun\d|wsl|loopback|bluetooth|zerotier|tailscale|wireguard|\bwg\d|npcap|pseudo|teredo|isatap|miniport/i;

/**
 * Stable machine fingerprint: sha256(hostname | primary-MAC | platform),
 * truncated to 24 hex chars.
 *
 * L19: the primary MAC is chosen deterministically: filter out virtual /
 * VPN-ish adapters, lowercase, de-dupe, sort, take the first, so the value
 * does NOT depend on OS interface-enumeration order (which reshuffles when a
 * dock or VPN adapter appears) and does not drift as those adapters come and
 * go. Enrollment persists this value and reuses the stored one thereafter, so
 * this recomputation runs only on a first-ever install.
 *
 * `ifaces` / `host` are injectable for unit tests; production callers pass
 * nothing and get the live machine values.
 */
export function machineFingerprint(
  ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces(),
  host: string = hostname()
): string {
  const macs: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const iface of list ?? []) {
      if (iface.internal) continue;
      if (!iface.mac || iface.mac === "00:00:00:00:00:00") continue;
      macs.push(iface.mac.toLowerCase());
    }
  }
  const primaryMac = Array.from(new Set(macs)).sort()[0] ?? "";
  const platform = process.platform;
  return createHash("sha256")
    .update(`${host}|${primaryMac}|${platform}`)
    .digest("hex")
    .slice(0, 24);
}
