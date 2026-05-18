import postgres from "postgres";
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

export interface PvsLinkRow {
  id: string;
  clinicId: string;
  pvsVendor: string;
  status: string;
  connectionConfig: Record<string, unknown>;
}

export async function listConnectedLinks(): Promise<PvsLinkRow[]> {
  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, connection_config
    FROM pvs_link
    WHERE status IN ('connected','pending')
  `;
  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    pvsVendor: r.pvs_vendor,
    status: r.status,
    connectionConfig: r.connection_config,
  }));
}

export async function loadDueLinks(now: Date): Promise<PvsLinkRow[]> {
  const rows = await db()<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT l.id, l.clinic_id, l.pvs_vendor, l.status, l.connection_config
    FROM pvs_link l
    LEFT JOIN pvs_sync_status s ON s.pvs_link_id = l.id
    WHERE l.status = 'connected'
      AND l.pvs_vendor IN ('tomedo')  -- polling adapters only
      AND (s.next_poll_at IS NULL OR s.next_poll_at <= ${now})
    ORDER BY s.next_poll_at NULLS FIRST
    LIMIT 50
  `;
  return rows.map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    pvsVendor: r.pvs_vendor,
    status: r.status,
    connectionConfig: r.connection_config,
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
    connection_config: Record<string, unknown>;
  }[]>`
    SELECT id, clinic_id, pvs_vendor, status, connection_config
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
  const { createDecipheriv } = require("node:crypto") as typeof import("node:crypto");
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
      last_incremental_cursor = EXCLUDED.last_incremental_cursor,
      consecutive_failure_count = 0,
      next_poll_at = EXCLUDED.next_poll_at,
      total_events_ingested = pvs_sync_status.total_events_ingested + EXCLUDED.total_events_ingested
  `;
}

/** Record a sync failure. Trips pvs_link.status='error' after FAIL_THRESHOLD. */
export async function recordFailure(
  linkId: string,
  error: string,
  failThreshold: number
): Promise<void> {
  await db()`
    INSERT INTO pvs_sync_status (pvs_link_id, last_error, last_error_at, consecutive_failure_count, next_poll_at)
    VALUES (${linkId}, ${error}, NOW(), 1, NOW() + INTERVAL '60 seconds')
    ON CONFLICT (pvs_link_id) DO UPDATE SET
      last_error = EXCLUDED.last_error,
      last_error_at = NOW(),
      consecutive_failure_count = pvs_sync_status.consecutive_failure_count + 1,
      next_poll_at = NOW() + (LEAST(pvs_sync_status.consecutive_failure_count, 10) * INTERVAL '60 seconds')
  `;
  await db()`
    UPDATE pvs_link
    SET status = 'error', updated_at = NOW()
    WHERE id = ${linkId}
      AND (SELECT consecutive_failure_count FROM pvs_sync_status WHERE pvs_link_id = ${linkId}) >= ${failThreshold}
  `;
}
