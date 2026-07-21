import { env } from "./config.js";
import { signBody } from "./canonical/sign.js";
import { loadClinicPvsSecret } from "./db/client.js";
import { fetchWithTimeout } from "./http.js";
import type { CanonicalEvent } from "./canonical/types.js";

/**
 * Bridge → Portal POST client.
 *
 * Loads the clinic's per-clinic PVS HMAC secret from `platform_credentials`,
 * signs the body, POSTs to `/api/pvs/events` (or `.../batch` for >5 events).
 *
 * Cached secrets are held in memory for SECRET_CACHE_TTL_MS so initial-sync
 * doesn't re-decrypt on every send. The cache is keyed by clinicId and
 * invalidated when the portal returns 400/401 (likely rotation).
 */

const SECRET_CACHE_TTL_MS = 5 * 60 * 1000;
const BATCH_THRESHOLD = 5;
const BATCH_MAX = 500;

interface CacheEntry {
  secret: string;
  expiresAt: number;
}
const secretCache = new Map<string, CacheEntry>();

async function getSecret(clinicId: string): Promise<string | null> {
  const cached = secretCache.get(clinicId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.secret;
  }
  const fresh = await loadClinicPvsSecret(clinicId);
  if (!fresh) return null;
  secretCache.set(clinicId, {
    secret: fresh,
    expiresAt: Date.now() + SECRET_CACHE_TTL_MS,
  });
  return fresh;
}

export interface PostResult {
  ok: boolean;
  status: number;
  body: unknown;
}

/** POST a single event. */
export async function postEvent(
  event: CanonicalEvent
): Promise<PostResult> {
  const secret = await getSecret(event.clinicId);
  if (!secret) {
    return {
      ok: false,
      status: 0,
      body: { error: "no_secret_for_clinic" },
    };
  }
  const raw = JSON.stringify(event);
  const sig = signBody(raw, secret);
  const res = await fetchWithTimeout(`${env().PORTAL_BASE_URL}/api/pvs/events`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body: raw,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 400 || res.status === 401) {
    // Likely secret rotated. Drop cache so next call re-loads.
    secretCache.delete(event.clinicId);
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * POST a batch of events for one clinic. The bridge automatically picks
 * batch vs single based on the count, but adapters can call this directly
 * for initial-sync where many events arrive at once.
 */
export async function postBatch(
  clinicId: string,
  events: CanonicalEvent[]
): Promise<PostResult> {
  if (events.length === 0) return { ok: true, status: 200, body: { ingested: 0 } };
  if (events.length === 1) return postEvent(events[0]!);
  if (events.length > BATCH_MAX) {
    // Caller chunks; do not split silently — they need to know batch sizes
    // matter (back-pressure, partial-failure semantics).
    throw new Error(`postBatch: max ${BATCH_MAX} events per call, got ${events.length}`);
  }

  const secret = await getSecret(clinicId);
  if (!secret) {
    return {
      ok: false,
      status: 0,
      body: { error: "no_secret_for_clinic" },
    };
  }
  const raw = JSON.stringify({ clinicId, events });
  const sig = signBody(raw, secret);
  const res = await fetchWithTimeout(`${env().PORTAL_BASE_URL}/api/pvs/events/batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-eins-signature": sig,
    },
    body: raw,
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 400 || res.status === 401) {
    secretCache.delete(clinicId);
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Helper used by adapter loops: automatically chunks a long iterable of
 * events into BATCH_MAX-sized batches and posts them sequentially.
 */
export async function postAll(
  clinicId: string,
  events: CanonicalEvent[]
): Promise<{ ingested: number; deduped: number; errors: number }> {
  let ingested = 0;
  let deduped = 0;
  let errors = 0;
  for (let i = 0; i < events.length; i += BATCH_MAX) {
    const chunk = events.slice(i, i + BATCH_MAX);
    if (chunk.length < BATCH_THRESHOLD) {
      for (const e of chunk) {
        const r = await postEvent(e);
        if (!r.ok) {
          errors += 1;
          continue;
        }
        const b = r.body as { status?: string };
        if (b.status === "deduped") deduped += 1;
        else ingested += 1;
      }
    } else {
      const r = await postBatch(clinicId, chunk);
      if (!r.ok) {
        errors += chunk.length;
      } else {
        const b = r.body as {
          ingested?: number;
          deduped?: number;
          errors?: unknown[];
        };
        ingested += b.ingested ?? 0;
        deduped += b.deduped ?? 0;
        errors += b.errors?.length ?? 0;
      }
    }
  }
  return { ingested, deduped, errors };
}
