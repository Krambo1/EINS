import { createHmac } from "node:crypto";
import { loadSecret } from "./secure-store.js";
import { loadConfig } from "./config.js";

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

export type PostResult =
  | { ok: true; deduped: boolean }
  | { ok: false; retryable: boolean; reason: string };

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
  /** Epoch-ms of when this heartbeat was produced. */
  sentAt: number;
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
  const config = await loadConfig();
  if (!config) return { ok: false, retryable: true, reason: "no_config" };
  const secret = await loadSecret();
  if (!secret) return { ok: false, retryable: true, reason: "no_secret" };

  const sig = `sha256=${createHmac("sha256", secret).update(rawJson).digest("hex")}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${config.portalBaseUrl.replace(/\/$/, "")}${path}`, {
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
    return {
      ok: false,
      retryable: true,
      reason: aborted
        ? `timeout after ${timeoutMs}ms`
        : `network: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    if (isRetryableStatus(res.status)) {
      return { ok: false, retryable: true, reason: `http ${res.status}` };
    }
    return {
      ok: false,
      retryable: false,
      reason: `http ${res.status}: ${await res.text().catch(() => "")}`,
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
  const config = await loadConfig();
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
    res = await fetch(`${config.portalBaseUrl.replace(/\/$/, "")}/api/pvs/events`, {
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
    return {
      ok: false,
      retryable: true,
      reason: aborted
        ? `timeout after ${EVENT_POST_TIMEOUT_MS}ms`
        : `network: ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    if (isRetryableStatus(res.status)) {
      return {
        ok: false,
        retryable: true,
        reason: `http ${res.status}`,
      };
    }
    return {
      ok: false,
      retryable: false,
      reason: `http ${res.status}: ${await res.text().catch(() => "")}`,
    };
  }
  const body = (await res.json().catch(() => ({}))) as { status?: string };
  return { ok: true, deduped: body.status === "deduped" };
}
