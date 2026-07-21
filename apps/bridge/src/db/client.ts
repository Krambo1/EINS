import postgres from "postgres";
import { createDecipheriv } from "node:crypto";
import { env } from "../config.js";

/**
 * Bridge → Portal DB connection (read-mostly).
 *
 * The bridge reads `pvs_link`, `pvs_sync_status`, and
 * `platform_credentials` (to decrypt the per-clinic HMAC secret).
 * It writes to `pvs_sync_status` to checkpoint cursors. Everything else
 * flows through the portal's HTTP API.
 *
 * In production, give this connection a role with SELECT on most tables
 * + UPDATE only on pvs_sync_status. The shared-DB pattern is the
 * simplest deployment; swap to an HTTP secret-broker if you need
 * a stricter trust boundary.
 */
let cached: ReturnType<typeof postgres> | null = null;

export function db() {
  if (!cached) {
    cached = postgres(env().BRIDGE_DATABASE_URL, {
      max: 5,
      idle_timeout: 20,
      onnotice: () => void 0,
    });
  }
  return cached;
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
  // checkpointSync writes it) so it actually round-trips. C7: push-adapter
  // links (healthhub, red) are ALSO selected while their initial sync has
  // not completed: they never poll, but their historical backfill runs
  // through the same scheduler branch.
  //
  // M-S4 self-recovery: status='error' links are ALSO selected, so a link the
  // scheduler tripped to 'error' is retried instead of being permanently dead
  // until a manual DB edit. recordFailure parks an error link's next_poll_at an
  // hour out, and the next_poll_at gate below throttles the retry to that
  // cadence; a successful poll/sync clears the error (see clearErrorStatus).
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
      AND (
        l.pvs_vendor IN ('tomedo','pabau','consentz')    -- polling adapters
        OR (
          l.pvs_vendor IN ('healthhub','red')            -- push adapters:
          AND s.last_initial_sync_completed_at IS NULL   -- initial sync only
        )
      )
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
  }
): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status
      (pvs_link_id, last_incremental_at, last_incremental_cursor,
       consecutive_failure_count, next_poll_at, total_events_ingested)
    VALUES (${linkId}, NOW(), ${input.cursor}, 0, ${input.nextPollAt}, ${input.eventsIngested})
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_incremental_at = NOW(),
      last_incremental_cursor = COALESCE(EXCLUDED.last_incremental_cursor, pvs_sync_status.last_incremental_cursor),
      consecutive_failure_count = 0,
      next_poll_at = EXCLUDED.next_poll_at,
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested
  `;
  // M-S4: a successful poll clears a self-recovered link's 'error' status.
  await clearErrorStatus(linkId);
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
  }
): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status
      (pvs_link_id, last_initial_sync_completed_at, last_incremental_cursor,
       consecutive_failure_count, next_poll_at, total_events_ingested)
    VALUES (${linkId}, NOW(), ${input.cursor}, 0, ${input.nextPollAt}, ${input.eventsIngested})
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_initial_sync_completed_at = NOW(),
      last_incremental_cursor = EXCLUDED.last_incremental_cursor,
      consecutive_failure_count = 0,
      next_poll_at = EXCLUDED.next_poll_at,
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested
  `;
  // M-S4: a completed initial sync clears a self-recovered link's 'error' status.
  await clearErrorStatus(linkId);
}

/** Record a sync failure. Trips pvs_link.status='error' after FAIL_THRESHOLD. */
export async function recordFailure(
  linkId: string,
  error: string,
  failThreshold: number
): Promise<void> {
  // Backoff. M-S4 off-by-one: the DO UPDATE used the PRE-increment count in the
  // next_poll_at math, so the first failure on an existing row scheduled
  // LEAST(0,10)*60s = an IMMEDIATE retry (a hot loop). Use the post-increment
  // count (`+ 1`) so the first failure waits one full backoff step. Once the
  // link has crossed FAIL_THRESHOLD it is in 'error' and we back off to an
  // hourly recovery cadence rather than hammering a dead link every 10 minutes.
  const rows = await db()<{ consecutive_failure_count: number }[]>`
    INSERT INTO pvs_sync_status (pvs_link_id, last_error, last_error_at, consecutive_failure_count, next_poll_at)
    VALUES (${linkId}, ${error}, NOW(), 1, NOW() + INTERVAL '60 seconds')
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_error = EXCLUDED.last_error,
      last_error_at = NOW(),
      consecutive_failure_count = pvs_sync_status.consecutive_failure_count + 1,
      next_poll_at = NOW() + (
        CASE
          WHEN pvs_sync_status.consecutive_failure_count + 1 >= ${failThreshold}
            THEN INTERVAL '1 hour'
          ELSE LEAST(pvs_sync_status.consecutive_failure_count + 1, 10) * INTERVAL '60 seconds'
        END
      )
    RETURNING consecutive_failure_count
  `;
  const count = rows[0]?.consecutive_failure_count ?? 1;
  if (count >= failThreshold) {
    // Trip to 'error' idempotently; RETURNING is non-empty only on the actual
    // transition, so we log loudly exactly once when a link enters error state.
    const tripped = await db()<{ id: string }[]>`
      UPDATE pvs_link
      SET status = 'error', updated_at = NOW()
      WHERE id = ${linkId} AND status <> 'error'
      RETURNING id
    `;
    if (tripped.length > 0) {
      console.error(
        `[db] pvs_link ${linkId} entered status=error after ${count} consecutive failures; ` +
          `last error: ${error}. It will be retried hourly for self-recovery.`
      );
    }
  }
}

/**
 * Restore a link from status='error' back to 'connected' after a successful
 * poll or initial sync (M-S4 self-recovery). RETURNING is non-empty only on the
 * actual transition, so we log loudly exactly once when a link recovers and stay
 * silent on every healthy poll.
 */
async function clearErrorStatus(linkId: string): Promise<void> {
  const recovered = await db()<{ id: string }[]>`
    UPDATE pvs_link
    SET status = 'connected', updated_at = NOW()
    WHERE id = ${linkId} AND status = 'error'
    RETURNING id
  `;
  if (recovered.length > 0) {
    console.log(
      `[db] pvs_link ${linkId} recovered from status=error back to connected`
    );
  }
}
