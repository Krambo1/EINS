import { createHmac } from "node:crypto";
import { loadSecret } from "./secure-store.js";
import { loadConfig, type AgentConfig } from "./config.js";
import { agentFetch, tlsHint } from "./net-setup.js";
import { portalEndpoint } from "./portal-url.js";

/**
 * HMAC-signed POST to the portal's /api/pvs/events endpoint. Used by the
 * outbox flush loop. We duplicate this from apps/bridge so the agent is
 * a single-binary, zero-monorepo-dep deliverable.
 *
 * P0-2: every fetch has a hard AbortController timeout. Without it, a
 * portal that holds the TCP socket open without responding blocks the
 * flush indefinitely, and the 5-second flush interval keeps stacking
 * concurrent flushes on top — within minutes the agent has hundreds of
 * sockets open and OOMs the Praxis workstation. The timeout floor is
 * deliberately generous (the portal's ingest path is fast; legitimate
 * latency tops out under 5s) so transient slowness retries cleanly.
 */

const EVENT_POST_TIMEOUT_MS = 30_000;
const HEARTBEAT_POST_TIMEOUT_MS = 15_000;

/**
 * L21: process-lifetime cache of the agent config.
 *
 * postSigned + postEvent used to call loadConfig() (a disk read + JSON parse)
 * on EVERY event POST and heartbeat. Two problems: it is needless disk churn
 * during an initial-sync burst, and, worse, a mid-run corruption of
 * config.json (a torn write, an operator hand-edit, AV quarantine) made
 * loadConfig throw on every subsequent POST, which the `.catch(() => null)`
 * silently converted into a `no_config` re-queue loop with nothing in the log
 * explaining why uploads stopped.
 *
 * The config only changes via enrollment, which restarts the process, so we
 * load it once, cache it for the lifetime, and reuse it. There is no periodic
 * reload path, so a later on-disk corruption is simply never re-read: the agent
 * keeps signing with the last-known-good config instead of flipping into the
 * silent no_config loop.
 */
let cachedConfig: AgentConfig | null = null;

async function getRuntimeConfig(): Promise<AgentConfig | null> {
  if (cachedConfig) return cachedConfig;
  try {
    const cfg = await loadConfig();
    if (cfg) cachedConfig = cfg;
    return cachedConfig;
  } catch (err) {
    // A corrupt config on the FIRST load (before we ever cached a good one)
    // is the only way to reach here. Log loudly and keep whatever we have
    // (null on a true first-load failure) rather than throwing into the flush
    // loop. On every later call the cached good config short-circuits above,
    // so a mid-run corruption never reaches this branch.
    console.error(
      `[portal-client] config load failed: ${(err as Error).message}. ` +
        (cachedConfig
          ? "Keeping the last-known-good in-memory config."
          : "No cached config yet; events will re-queue until this is fixed.")
    );
    return cachedConfig;
  }
}

/** Test-only: drop the cached config between cases. */
export function _resetConfigCacheForTests(): void {
  cachedConfig = null;
}

export type PostResult =
  | { ok: true; deduped: boolean }
  | {
      ok: false;
      retryable: boolean;
      reason: string;
      /**
       * H11: true when the portal rejected our signature (auth-class), which
       * a re-enrollment / correct-secret fixes. The flush loop treats this
       * specially: rows stay pending and flushing pauses, instead of being
       * marked permanently failed and pruned after 30 days. Undefined/false
       * for every other failure (transient network, validation reject, etc.).
       */
      authFailure?: boolean;
      /**
       * M-A3: true for a transport-level failure (connection refused / DNS /
       * TLS) or our own AbortController timeout. The portal is unreachable, so
       * every other due row in the same flush cycle would fail identically
       * (and each burns a full 30s timeout). The flush loop uses this to
       * fast-abort the cycle instead of grinding through all ~50 rows.
       */
      networkFailure?: boolean;
      /**
       * M-A3: the backoff the portal requested via a Retry-After header, in ms
       * (parsed from delta-seconds or an HTTP-date, clamped to RETRY_AFTER_MAX_MS).
       * Present only on retryable HTTP rejections (429 / 503 / ...) that carried
       * the header. The flush loop aborts the cycle when set and surfaces the
       * value so the scheduler can space out the next flush.
       */
      retryAfterMs?: number;
    };

/**
 * M-A3: upper bound on a respected Retry-After. A misconfigured or hostile
 * portal must not be able to park the outbox for hours; five minutes is well
 * past any legitimate rate-limit window while still letting the queue drain
 * on the next cycle.
 */
export const RETRY_AFTER_MAX_MS = 5 * 60_000;

function clampRetryAfterMs(ms: number): number {
  if (ms <= 0) return 0;
  return Math.min(ms, RETRY_AFTER_MAX_MS);
}

/**
 * M-A3: parse a Retry-After header value into a clamped millisecond backoff.
 * Supports both RFC 7231 forms:
 *   • delta-seconds: a non-negative integer number of seconds.
 *   • HTTP-date: an absolute date; the delay is (date - now), floored at 0.
 * Returns null for a missing / empty / unparseable value so the caller can
 * fall back to its normal retry cadence. Pure + testable: `now` is injected.
 */
export function parseRetryAfterMs(
  headerValue: string | null | undefined,
  now: number
): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (trimmed === "") return null;
  // delta-seconds: a bare non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    if (!Number.isFinite(seconds)) return null;
    return clampRetryAfterMs(seconds * 1000);
  }
  // HTTP-date: absolute instant; convert to a delay relative to now.
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return clampRetryAfterMs(dateMs - now);
}

/**
 * H11: classify a portal HTTP rejection as auth-class (signature/credential)
 * vs. everything else. Auth-class rejections must NOT be permanent-failed,
 * because a stale or rotated secret is recoverable by re-enrollment.
 *
 *   • 401 / 403: explicit auth rejection (defensive: the current portal
 *     returns a symmetric 400 for bad signatures, but a future or proxied
 *     deployment may surface the standard auth codes).
 *   • 400 with body error code `invalid_request`: the portal's symmetric
 *     "invalid_request" is exactly what /api/pvs/events and the heartbeat
 *     route return on a signature mismatch (genericFail()), deliberately
 *     indistinguishable from a probe so clinics can't be enumerated. On the
 *     agent side we DO know we sent a real signed body, so a 400/invalid_request
 *     means our secret is wrong.
 *
 * A genuinely malformed event returns 400 with `invalid_envelope` /
 * `invalid_bridge_source`; a missing clinic returns 404 `clinic_not_found`.
 * Those are NOT auth-class and stay on their existing retry/permanent paths.
 *
 * Pure + testable: takes the status and the raw response body text.
 */
export function isAuthClassRejection(status: number, bodyText: string): boolean {
  if (status === 401 || status === 403) return true;
  if (status !== 400) return false;
  return /"code"\s*:\s*"invalid_request"/.test(bodyText);
}

/**
 * Which HTTP responses the agent should re-queue (retry) rather than drop.
 *
 * Retryable (transient):
 *   • 429 — rate limited.
 *   • 5xx — portal / infra error.
 *   • 408, 425 — request timeout / too-early.
 *   • 409 — the portal returns `link_not_ready` while a pvs_link is still
 *     being confirmed by the operator (see apps/portal/src/server/pvs-events.ts).
 *     That is the textbook *recoverable* state: the link WILL become ready.
 *     Treating it as permanent silently dropped every event the agent sent
 *     before link-confirmation.
 *
 * Non-retryable (drop, surface via the failure-summary heartbeat):
 *   • 400 — invalid envelope / vendor mismatch: the event is genuinely
 *     malformed, so retrying forever is pointless and masks the bug.
 *   • 404 — clinic not found: a real misconfiguration, not a transient blip.
 */
function isRetryableStatus(status: number): boolean {
  if (status === 429 || status >= 500) return true;
  return status === 408 || status === 409 || status === 425;
}

// ---------------------------------------------------------------
// P2-2: heartbeat + failure-summary payloads
// ---------------------------------------------------------------

export interface HeartbeatPayload {
  clinicId: string;
  agentVersion: string;
  /** Number of currently-failed outbox rows. */
  failedCount: number;
  /** Earliest created_at among failed rows (epoch-ms), or null. */
  oldestFailedAt: number | null;
  /** Most-recent `last_error` text from a failed row, or null. */
  lastFailureReason: string | null;
  /** Top 10 distinct failure reasons (with counts). */
  recentReasons: Array<{ reason: string; count: number }>;
  /**
   * Phase 8: the distinct bridge_sources this agent currently emits. Built
   * from the enabled DB-adapter vendors (via bridgeSourceForVendor) plus
   * "gdt_agent" whenever the GDT file-watcher is active. The portal upserts
   * each into pvs_link_source so the clinic is allowed to emit them; this is
   * what makes the post-upgrade window lossless, because a freshly
   * per-vendor-stamped event (e.g. medatixx) would otherwise 409 until the
   * clinic is enrolled for that source. Bounded by the fixed vendor set
   * (<= 9 distinct sources); the portal caps the array at 20.
   */
  enrolledVendors: string[];
  /** Epoch-ms of when this heartbeat was produced. */
  sentAt: number;
  /**
   * H10c / H13: additive operational-health fields.
   *
   * These exist because `failedCount` is a DEAD-LETTER counter: it only
   * counts rows that were read, attempted and permanently rejected. A
   * permanently-retrying outbox, a missing watch folder and DB adapters that
   * never started all report failedCount = 0 while delivering zero events,
   * which is indistinguishable from a quiet week at the Praxis.
   *
   * Portal side: persisted since migration 0069 (pvs_agent_status) and used
   * to raise the pvs_agent_health dashboard alerts. Still optional on the
   * wire so an older agent keeps working; the portal treats an absent field
   * as "this build cannot report it" and leaves the stored value alone
   * rather than resetting it to a healthy-looking zero.
   */
  /** Pending (not-yet-delivered) outbox rows; the live retry backlog. */
  pendingCount?: number;
  /** Oldest created_at among pending rows (epoch-ms), or null. */
  oldestPendingAt?: number | null;
  /** Configured watch folders that are missing from disk at report time. */
  missingFolders?: string[];
  /** Non-null when startRunner threw: the DB adapters are NOT running. */
  dbAdaptersFailed?: string | null;
}

export interface FailureSummaryPayload {
  clinicId: string;
  /** Window the pruned rows covered (epoch-ms). */
  prunedOldestAt: number | null;
  prunedNewestAt: number | null;
  prunedCount: number;
  /** Reasons grouped (top 10 by count). */
  reasons: Array<{ reason: string; count: number }>;
  sentAt: number;
}

async function postSigned(
  path: string,
  rawJson: string,
  timeoutMs: number
): Promise<PostResult> {
  // H13.2 / L21: config is cached for the process lifetime, so a mid-run
  // corruption of config.json is never re-read and can't wedge the flush loop.
  // A true first-load failure (never yet cached) yields null → transient
  // no_config so the outbox re-queues rather than dropping the event.
  const config = await getRuntimeConfig();
  if (!config) return { ok: false, retryable: true, reason: "no_config" };
  const secret = await loadSecret();
  if (!secret) return { ok: false, retryable: true, reason: "no_secret" };

  const sig = `sha256=${createHmac("sha256", secret).update(rawJson).digest("hex")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await agentFetch(portalEndpoint(config.portalBaseUrl, path), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eins-signature": sig,
      },
      body: rawJson,
      signal: controller.signal,
    });
  } catch (err) {
    const aborted =
      (err as { name?: string }).name === "AbortError" || controller.signal.aborted;
    if (aborted) {
      return { ok: false, retryable: true, reason: `timeout after ${timeoutMs}ms` };
    }
    // H12: surface a targeted TLS-inspection hint when the cause chain shows
    // a certificate-verification failure (corporate middlebox re-signing).
    const hint = tlsHint(err);
    return {
      ok: false,
      retryable: true,
      reason: `network: ${(err as Error).message}${hint ? ` [${hint}]` : ""}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    if (isRetryableStatus(res.status)) {
      return { ok: false, retryable: true, reason: `http ${res.status}` };
    }
    const bodyText = await res.text().catch(() => "");
    if (isAuthClassRejection(res.status, bodyText)) {
      return {
        ok: false,
        retryable: false,
        authFailure: true,
        reason: `http ${res.status} (auth rejected): ${bodyText}`,
      };
    }
    return {
      ok: false,
      retryable: false,
      reason: `http ${res.status}: ${bodyText}`,
    };
  }
  return { ok: true, deduped: false };
}

/**
 * P2-2: POST the heartbeat payload to /api/pvs/agent/heartbeat. Best-
 * effort — a failure here does NOT block event flush. The portal upserts
 * pvs_agent_status by clinicId. A 15s timeout is plenty (the endpoint
 * is a single small upsert) and tighter than the 30s event timeout so
 * a hung portal can't stall the heartbeat tick.
 */
export async function postHeartbeat(
  payload: HeartbeatPayload
): Promise<PostResult> {
  return postSigned(
    "/api/pvs/agent/heartbeat",
    JSON.stringify(payload),
    HEARTBEAT_POST_TIMEOUT_MS
  );
}

/**
 * P2-2: POST the prune summary to /api/pvs/agent/failure-summary before
 * the agent deletes the underlying rows. The portal stores a permanent
 * record so the operator can still see "we lost 47 events from
 * 2026-04-01..2026-04-30 due to bad signature" months later, even after
 * the rows themselves are gone.
 */
export async function postFailureSummary(
  payload: FailureSummaryPayload
): Promise<PostResult> {
  return postSigned(
    "/api/pvs/agent/failure-summary",
    JSON.stringify(payload),
    HEARTBEAT_POST_TIMEOUT_MS
  );
}

export async function postEvent(rawJson: string): Promise<PostResult> {
  // H13.2 / L21: config is cached for the process lifetime (see
  // getRuntimeConfig). A mid-run corruption is never re-read, so this never
  // flips a running agent into a silent no_config loop.
  const config = await getRuntimeConfig();
  if (!config) return { ok: false, retryable: true, reason: "no_config" };
  const secret = await loadSecret();
  if (!secret) return { ok: false, retryable: true, reason: "no_secret" };

  const sig = `sha256=${createHmac("sha256", secret).update(rawJson).digest("hex")}`;
  let res: Response;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    EVENT_POST_TIMEOUT_MS
  );
  try {
    res = await agentFetch(portalEndpoint(config.portalBaseUrl, "/api/pvs/events"), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-eins-signature": sig,
      },
      body: rawJson,
      signal: controller.signal,
    });
  } catch (err) {
    // AbortError from our own timeout is reported as a distinct, retryable
    // reason so operators can tell "portal hung" apart from generic
    // connection refused / DNS / TLS failures.
    const aborted =
      (err as { name?: string }).name === "AbortError" || controller.signal.aborted;
    if (aborted) {
      // M-A3: our own timeout fired. Flag it network-class so the flush loop
      // fast-aborts the cycle rather than spending 30s per remaining row.
      return {
        ok: false,
        retryable: true,
        networkFailure: true,
        reason: `timeout after ${EVENT_POST_TIMEOUT_MS}ms`,
      };
    }
    // H12: attach a TLS-inspection hint when the underlying cause is a
    // certificate-verification failure.
    const hint = tlsHint(err);
    // M-A3: transport-level failure (connection refused / DNS / TLS). The
    // portal is unreachable, so every other due row would fail identically.
    return {
      ok: false,
      retryable: true,
      networkFailure: true,
      reason: `network: ${(err as Error).message}${hint ? ` [${hint}]` : ""}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    if (isRetryableStatus(res.status)) {
      // M-A3: honour a Retry-After hint (429 / 503 rate-limit or drain window).
      const retryAfterMs = parseRetryAfterMs(
        res.headers.get("retry-after"),
        Date.now()
      );
      return {
        ok: false,
        retryable: true,
        reason: `http ${res.status}`,
        ...(retryAfterMs !== null ? { retryAfterMs } : {}),
      };
    }
    const bodyText = await res.text().catch(() => "");
    if (isAuthClassRejection(res.status, bodyText)) {
      // H11: signature/credential rejection. Keep the event; the flush loop
      // pauses and holds rows pending rather than permanent-failing them.
      return {
        ok: false,
        retryable: false,
        authFailure: true,
        reason: `http ${res.status} (auth rejected): ${bodyText}`,
      };
    }
    return {
      ok: false,
      retryable: false,
      reason: `http ${res.status}: ${bodyText}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as { status?: string };
  return { ok: true, deduped: body.status === "deduped" };
}
