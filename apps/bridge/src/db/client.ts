import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
import { env } from "../config.js";

/**
 * Bridge → Portal DB connection (read-mostly).
 *
 * The bridge reads `pvs_link`, `pvs_sync_status`, and
 * `platform_credentials` (to decrypt the per-clinic HMAC secret).
 * It writes to `pvs_sync_status` to checkpoint cursors, claim leases and record
 * failure/backoff state. It does NOT write `pvs_link.status`: the portal rejects
 * every event for an 'error' link (link_not_ready), so a bridge that tripped a
 * link to 'error' could never recover it. Failure state lives in
 * pvs_sync_status (last_error, consecutive_failure_count) and /healthz.
 * Everything else flows through the portal's HTTP API.
 *
 * In production, give this connection a role with SELECT on most tables
 * + INSERT/UPDATE only on pvs_sync_status. The shared-DB pattern is the
 * simplest deployment; swap to an HTTP secret-broker if you need
 * a stricter trust boundary.
 */
let cached: ReturnType<typeof postgres> | null = null;

/**
 * Neon's pooled endpoints (host contains "-pooler") and any DSN carrying
 * ?pgbouncer=true sit behind pgbouncer in transaction mode, which does not
 * support prepared statements. Same detection as the portal
 * (apps/portal/src/db/client.ts).
 */
export function usesPgBouncer(url: string): boolean {
  return /-pooler\./.test(url) || /[?&]pgbouncer=true\b/.test(url);
}

export function db() {
  if (!cached) {
    const url = env().BRIDGE_DATABASE_URL;
    cached = postgres(url, {
      max: 5,
      idle_timeout: 20,
      // A black-holed DB must fail the tick fast, not hang it.
      connect_timeout: 10,
      prepare: !usesPgBouncer(url),
      connection: { statement_timeout: 15_000 },
      onnotice: () => void 0,
    });
  }
  return cached;
}

/** SELECT 1 within `timeoutMs`; false on any error or timeout (for /healthz). */
export async function pingDb(timeoutMs = 2_000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      db()`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("db ping timeout")), timeoutMs);
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type PreferredPath = "auto" | "rest" | "db_read";

export interface PvsLinkRow {
  id: string;
  clinicId: string;
  pvsVendor: string;
  status: string;
  preferredPath: PreferredPath;
  connectionConfig: Record<string, unknown>;
  /** pvs_sync_status.last_incremental_cursor: the poll watermark. Only
   *  populated by loadDueLinks (C5: the scheduler used to read a cursor
   *  from connectionConfig that nothing ever wrote, so every poll
   *  refetched full history since 1970). Null before the first poll. */
  lastCursor?: string | null;
  /** pvs_sync_status.last_initial_sync_completed_at. Only populated by
   *  loadDueLinks; null until the initial sync has run to completion (C7),
   *  which is the scheduler's signal to run it instead of polling. */
  initialSyncCompletedAt?: string | null;
}

function coercePreferredPath(value: unknown): PreferredPath {
  return value === "rest" || value === "db_read" ? value : "auto";
}

/**
 * pvs_link.status values that mean the link is NOT currently accepting
 * inbound deliveries (schema enum: unconfigured, akkreditierung, pending,
 * connected, error, disconnected: see apps/portal/src/db/schema-pvs.ts).
 *
 * A push webhook (healthhub, red) that arrives for one of these is ignored
 * with a 200 so the vendor's FHIR Subscription does not retry-storm a dead
 * link. 'pending' and 'akkreditierung' are deliberately NOT here: the portal
 * ingest API quarantines their events by design (migration 0045), so those
 * still flow through and are decided downstream.
 */
export const INACTIVE_LINK_STATUSES = new Set([
  "unconfigured",
  "error",
  "disconnected",
]);

export async function listConnectedLinks(): Promise<PvsLinkRow[]> {
  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    preferred_path: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, preferred_path, connection_config
    FROM pvs_link
    WHERE status IN ('connected','pending')
  `;
  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    pvsVendor: r.pvs_vendor,
    status: r.status,
    preferredPath: coercePreferredPath(r.preferred_path),
    connectionConfig: r.connection_config,
  }));
}

export async function loadDueLinks(now: Date): Promise<PvsLinkRow[]> {
  // The cloud scheduler only owns the REST/poll path. A link with
  // preferred_path='db_read' is opted out: the on-prem SQL-introspection
  // agent owns it instead. preferred_path='auto' and 'rest' both flow
  // through here so the scheduler stays the source of truth for
  // single-path vendors that don't have a db-read counterpart.
  //
  // C5: the poll cursor is joined in from pvs_sync_status (the one place
  // checkpointSync writes it) so it actually round-trips.
  //
  // Push vendors (red, healthhub) are deliberately NOT selected. They have an
  // initial sync here but no subscription wizard and no incremental pass yet
  // (their live events would arrive through the inbound webhook, which nothing
  // registers), so a hand-inserted link would finish its backfill and then sit
  // there silently dead. Not starting it is the honest state until that exists.
  // The adapters stay registered in the scheduler for when they are wired up.
  //
  // Legacy: status='error' links are ALSO selected. Older bridge versions
  // tripped pvs_link.status to 'error' after N failures, which the portal
  // answers with link_not_ready for every event, so such a link could never
  // recover. The scheduler un-trips it when it claims the link
  // (restoreLegacyErrorStatus); the bridge no longer writes 'error' itself.
  // Callers must claimLink() before working a returned row: this SELECT is a
  // candidate list, not a lock.
  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    preferred_path: string;
    connection_config: Record<string, unknown>;
    last_incremental_cursor: string | null;
    last_initial_sync_completed_at: string | null;
  }[]>`
    SELECT l.id, l.clinic_id, l.pvs_vendor, l.status, l.preferred_path, l.connection_config,
           s.last_incremental_cursor, s.last_initial_sync_completed_at
    FROM pvs_link l
    LEFT JOIN pvs_sync_status s ON s.pvs_link_id = l.id
    WHERE (l.status = 'connected' OR l.status = 'error')  -- 'error' self-recovers (M-S4)
      AND l.preferred_path <> 'db_read'                  -- skip on-prem-owned links
      AND l.pvs_vendor IN ('tomedo','pabau','consentz')  -- polling adapters only
      AND (s.next_poll_at IS NULL OR s.next_poll_at <= ${now})
    ORDER BY s.next_poll_at NULLS FIRST
    LIMIT 50
  `;
  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    pvsVendor: r.pvs_vendor,
    status: r.status,
    preferredPath: coercePreferredPath(r.preferred_path),
    connectionConfig: r.connection_config,
    lastCursor: r.last_incremental_cursor,
    initialSyncCompletedAt: r.last_initial_sync_completed_at,
  }));
}

export async function getLinkByClinicAndVendor(
  clinicId: string,
  vendor: string
): Promise<PvsLinkRow | null> {
  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    preferred_path: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, preferred_path, connection_config
    FROM pvs_link
    WHERE clinic_id = ${clinicId} AND pvs_vendor = ${vendor}
    LIMIT 1
  `;
  return rows[0]
    ? {
        id: rows[0].id,
        clinicId: rows[0].clinic_id,
        pvsVendor: rows[0].pvs_vendor,
        status: rows[0].status,
        preferredPath: coercePreferredPath(rows[0].preferred_path),
        connectionConfig: rows[0].connection_config,
      }
    : null;
}

/**
 * Decrypt the per-clinic PVS HMAC secret from platform_credentials.
 * Layout matches apps/portal/src/lib/crypto.ts: [iv(12) | tag(16) | ciphertext].
 */
export async function loadClinicPvsSecret(
  clinicId: string
): Promise<string | null> {
  const rows = await db()<{ access_token_enc: Buffer }[]>`
    SELECT access_token_enc
    FROM platform_credentials
    WHERE clinic_id = ${clinicId} AND platform = 'pvs'
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return decryptString(rows[0]!.access_token_enc);
}

function decryptString(blob: Buffer): string {
  // C6: this used to call require("node:crypto"), but this package is
  // "type": "module": require is undefined at runtime, so the first
  // decryption threw a ReferenceError and no event could ever be signed.
  // Typecheck never caught it because @types/node declares a global require.
  if (blob.length < 28) throw new Error("ciphertext too short");
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  const key = Buffer.from(env().APP_KEY, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Atomically claim a link for ONE scheduler (mutual exclusion across machines).
 *
 * loadDueLinks is only a candidate list. The claim pushes next_poll_at out by
 * `leaseMs` iff the link is still due, in a single INSERT .. ON CONFLICT DO
 * UPDATE .. WHERE, so exactly one caller gets a row back even if two machines
 * (a rolling deploy, an accidental scale-out) race on the same link. The lease
 * is released by the work itself: checkpointSync / releaseLink / recordFailure
 * all write a fresh next_poll_at. A crashed machine's lease simply expires.
 */
export async function claimLink(linkId: string, leaseMs: number): Promise<boolean> {
  const leaseSec = Math.max(1, Math.ceil(leaseMs / 1000));
  const rows = await db()<{ pvs_link_id: string }[]>`
    INSERT INTO pvs_sync_status (pvs_link_id, next_poll_at)
    VALUES (${linkId}, NOW() + ${leaseSec}::float8 * INTERVAL '1 second')
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      next_poll_at = EXCLUDED.next_poll_at
    WHERE pvs_sync_status.next_poll_at IS NULL
       OR pvs_sync_status.next_poll_at <= NOW()
    RETURNING pvs_link_id
  `;
  return rows.length > 0;
}

/** Update sync-status checkpoint after a successful poll. */
export async function checkpointSync(
  linkId: string,
  input: {
    /** Adapter-format cursor. null means "no advance" per the adapter
     *  contract (a poll that returned nothing new, or a push adapter with
     *  no poll watermark). We must NOT overwrite the stored cursor with
     *  NULL in that case, or the next poll resets to the epoch and
     *  re-downloads all history (a real bug once C5 lands). COALESCE keeps
     *  the existing value untouched when the incoming cursor is null. */
    cursor: string | null;
    eventsIngested: number;
    nextPollAt: Date;
    /** Non-fatal note from a SUCCESSFUL poll (e.g. "3 event(s) permanently
     *  rejected by the portal and skipped: invalid_envelope x3"). Stored in
     *  last_error so ops can see it; null clears a stale error. */
    warning?: string | null;
  }
): Promise<void> {
  const warning = input.warning ? input.warning.slice(0, 1000) : null;
  await db()`
    INSERT INTO pvs_sync_status
      (pvs_link_id, last_incremental_at, last_incremental_cursor,
       consecutive_failure_count, next_poll_at, total_events_ingested,
       last_error, last_error_at)
    VALUES (${linkId}, NOW(), ${input.cursor}, 0, ${input.nextPollAt}, ${input.eventsIngested},
            ${warning}, ${warning ? new Date() : null})
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_incremental_at = NOW(),
      last_incremental_cursor = COALESCE(EXCLUDED.last_incremental_cursor, pvs_sync_status.last_incremental_cursor),
      consecutive_failure_count = 0,
      next_poll_at = EXCLUDED.next_poll_at,
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested,
      last_error = EXCLUDED.last_error,
      last_error_at = COALESCE(EXCLUDED.last_error_at, pvs_sync_status.last_error_at)
  `;
}

/**
 * Persist progress WITHOUT touching scheduling state: the cursor (poll
 * watermark, or the initial-sync resume token while the initial sync is still
 * running) and the number of events accepted since the last save. Called after
 * every accepted chunk so a crash/restart resumes instead of starting over.
 * A null cursor leaves the stored one untouched.
 */
export async function saveProgress(
  linkId: string,
  input: { cursor: string | null; eventsIngested: number }
): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status
      (pvs_link_id, last_incremental_cursor, total_events_ingested)
    VALUES (${linkId}, ${input.cursor}, ${input.eventsIngested})
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_incremental_cursor = COALESCE(EXCLUDED.last_incremental_cursor, pvs_sync_status.last_incremental_cursor),
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested
  `;
}

/** Make a link due again at `nextPollAt` (releases a claim lease) without
 *  recording success or failure, e.g. an initial-sync run that used up its time
 *  budget but made progress. */
export async function releaseLink(linkId: string, nextPollAt: Date): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status (pvs_link_id, next_poll_at)
    VALUES (${linkId}, ${nextPollAt})
    ON CONFLICT (pvs_link_id) DO UPDATE SET next_poll_at = EXCLUDED.next_poll_at
  `;
}

/** Stamp the start of an initial-sync attempt (C7). Kept separate from
 *  completion so a crashed/failed attempt is visible in ops queries. */
export async function markInitialSyncStarted(linkId: string): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status (pvs_link_id, last_initial_sync_started_at)
    VALUES (${linkId}, NOW())
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_initial_sync_started_at = NOW()
  `;
}

/**
 * Mark the initial sync complete and seed the incremental-poll cursor with
 * the sync-start watermark (C7). Seeding matters: without it the first
 * incremental poll starts from the epoch and re-downloads the entire
 * history the initial sync just ingested.
 */
export async function completeInitialSync(
  linkId: string,
  input: {
    /** Adapter-format cursor seeded at the initial-sync START timestamp
     *  (anything modified during the sync is re-fetched once and deduped).
     *  Null for push adapters, which have no poll cursor. */
    cursor: string | null;
    eventsIngested: number;
    nextPollAt: Date;
    warning?: string | null;
  }
): Promise<void> {
  const warning = input.warning ? input.warning.slice(0, 1000) : null;
  await db()`
    INSERT INTO pvs_sync_status
      (pvs_link_id, last_initial_sync_completed_at, last_incremental_cursor,
       consecutive_failure_count, next_poll_at, total_events_ingested,
       last_error, last_error_at)
    VALUES (${linkId}, NOW(), ${input.cursor}, 0, ${input.nextPollAt}, ${input.eventsIngested},
            ${warning}, ${warning ? new Date() : null})
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_initial_sync_completed_at = NOW(),
      last_incremental_cursor = EXCLUDED.last_incremental_cursor,
      consecutive_failure_count = 0,
      next_poll_at = EXCLUDED.next_poll_at,
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested,
      last_error = EXCLUDED.last_error,
      last_error_at = COALESCE(EXCLUDED.last_error_at, pvs_sync_status.last_error_at)
  `;
}

/**
 * Record a sync failure and schedule the retry. Failure state lives ONLY in
 * pvs_sync_status (last_error, last_error_at, consecutive_failure_count,
 * next_poll_at); pvs_link.status is never touched. A link never stops being
 * retried: the backoff grows 1 min per consecutive failure up to 10 min and,
 * once consecutive failures reach `failThreshold`, settles at 15 min so an
 * outage is recovered from within minutes of the vendor/portal coming back.
 *
 * `retryAfterMs` (e.g. a portal 429 Retry-After) is a floor for the delay.
 */
export async function recordFailure(
  linkId: string,
  error: string,
  failThreshold: number,
  retryAfterMs = 0
): Promise<void> {
  // Backoff. M-S4 off-by-one: the DO UPDATE used the PRE-increment count in the
  // next_poll_at math, so the first failure on an existing row scheduled
  // LEAST(0,10)*60s = an IMMEDIATE retry (a hot loop). Use the post-increment
  // count (`+ 1`) so the first failure waits one full backoff step.
  const message = error.slice(0, 1000);
  const floorSec = Math.max(0, Math.ceil(retryAfterMs / 1000));
  const rows = await db()<{ consecutive_failure_count: number }[]>`
    INSERT INTO pvs_sync_status (pvs_link_id, last_error, last_error_at, consecutive_failure_count, next_poll_at)
    VALUES (${linkId}, ${message}, NOW(), 1,
            NOW() + GREATEST(60, ${floorSec})::float8 * INTERVAL '1 second')
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_error = EXCLUDED.last_error,
      last_error_at = NOW(),
      consecutive_failure_count = pvs_sync_status.consecutive_failure_count + 1,
      next_poll_at = NOW() + GREATEST(
        ${floorSec}::float8 * INTERVAL '1 second',
        CASE
          WHEN pvs_sync_status.consecutive_failure_count + 1 >= ${failThreshold}
            THEN INTERVAL '15 minutes'
          ELSE LEAST(pvs_sync_status.consecutive_failure_count + 1, 10) * INTERVAL '60 seconds'
        END
      )
    RETURNING consecutive_failure_count
  `;
  const count = rows[0]?.consecutive_failure_count ?? 1;
  if (count === failThreshold) {
    // Loud, once: the link keeps being retried (status is NOT changed).
    console.error(
      `[db] pvs_link ${linkId}: ${count} consecutive sync failures; last error: ${message}. ` +
        `Still retrying every 15 min (pvs_link.status left untouched).`
    );
  }
}

/**
 * Legacy un-trip. Bridge versions before this one wrote pvs_link.status='error'
 * after FAIL_THRESHOLD failures; the portal answers link_not_ready for every
 * event on such a link, so it could never recover on its own. The only writer
 * of 'error' was the bridge, so when the scheduler claims a link that is still
 * in that state it restores 'connected'. RETURNING is non-empty only on the
 * actual transition, so it logs once and is silent on healthy links. A role
 * without UPDATE on pvs_link just fails this call; the caller swallows that.
 */
export async function restoreLegacyErrorStatus(linkId: string): Promise<boolean> {
  const recovered = await db()<{ id: string }[]>`
    UPDATE pvs_link
    SET status = 'connected', updated_at = NOW()
    WHERE id = ${linkId} AND status = 'error'
    RETURNING id
  `;
  if (recovered.length > 0) {
    console.log(
      `[db] pvs_link ${linkId} un-tripped from legacy status=error back to connected`
    );
  }
  return recovered.length > 0;
}

/** Links currently failing / failing past the threshold (for /healthz, informational). */
export async function failingLinkSummary(
  failThreshold: number
): Promise<{ failing: number; stuck: number }> {
  const rows = await db()<{ failing: string; stuck: string }[]>`
    SELECT
      COUNT(*) FILTER (WHERE consecutive_failure_count > 0) AS failing,
      COUNT(*) FILTER (WHERE consecutive_failure_count >= ${failThreshold}) AS stuck
    FROM pvs_sync_status
  `;
  return { failing: Number(rows[0]?.failing ?? 0), stuck: Number(rows[0]?.stuck ?? 0) };
}
