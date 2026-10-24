import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptString } from "@/lib/crypto";

/**
 * Process-local LRU for decrypted per-clinic HMAC secrets. PVS adapters
 * occasionally fire bursts of N events from one clinic in quick succession
 * (initial-sync from Tomedo / RED); without caching, every event re-hits
 * the DB and re-runs `decryptString` to verify the signature.
 *
 * 30 s TTL for found secrets (2 s for "no row", A-18), a re-read on a
 * signature mismatch, AND we explicitly invalidate from both rotation paths
 * (mintAndStorePvsSecret here + rotateIntakeSecretAction in einstellungen/
 * actions.ts) so a rotation doesn't strand callers using the new secret.
 *
 * Cache key is `(clinicId, platform)` — purpose is collapsed to platform
 * because every non-PVS purpose resolves to the same 'intake' row.
 */
const SECRET_CACHE_TTL_MS = 30_000;
/**
 * "No credential row" is cached only briefly (A-18): right after a secret is
 * created on another serverless instance, a cached `null` would otherwise
 * reject valid calls for up to 30 s.
 */
const NEGATIVE_CACHE_TTL_MS = 2_000;
/** On a signature mismatch with a cached secret, re-read the row at most this often. */
const MISMATCH_RELOAD_MIN_INTERVAL_MS = 1_000;
const SECRET_CACHE_MAX = 256;

/**
 * Secrets accepted for one (clinic, platform). `previous` is the secret
 * before the last intake rotation, accepted until `previousValidUntil`
 * (C-34 / F-11: 24 h overlap so a rotation does not break the Zielseite).
 */
export interface SecretSet {
  current: string | null;
  previous: string | null;
  previousValidUntil: number | null;
}
type CacheEntry = { set: SecretSet; expiresAt: number; loadedAt: number };
const secretCache = new Map<string, CacheEntry>();

function cacheKey(clinicId: string, platform: "intake" | "pvs"): string {
  return `${clinicId}:${platform}`;
}

function cacheGet(key: string): CacheEntry | undefined {
  const entry = secretCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    secretCache.delete(key);
    return undefined;
  }
  // Refresh recency for naive LRU eviction.
  secretCache.delete(key);
  secretCache.set(key, entry);
  return entry;
}

function cacheSet(key: string, set: SecretSet): CacheEntry {
  if (secretCache.size >= SECRET_CACHE_MAX) {
    const oldest = secretCache.keys().next().value;
    if (oldest !== undefined) secretCache.delete(oldest);
  }
  const now = Date.now();
  const entry: CacheEntry = {
    set,
    loadedAt: now,
    expiresAt: now + (set.current ? SECRET_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  };
  secretCache.set(key, entry);
  return entry;
}

async function loadSecretSet(
  clinicId: string,
  platform: "intake" | "pvs"
): Promise<SecretSet> {
  const [cred] = await db
    .select({
      accessTokenEnc: schema.platformCredentials.accessTokenEnc,
      previousAccessTokenEnc: schema.platformCredentials.previousAccessTokenEnc,
      previousValidUntil: schema.platformCredentials.previousValidUntil,
    })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, platform)
      )
    )
    .limit(1);
  const previousValidUntil = cred?.previousValidUntil?.getTime() ?? null;
  const previousUsable =
    !!cred?.previousAccessTokenEnc &&
    previousValidUntil !== null &&
    previousValidUntil > Date.now();
  return {
    current: cred?.accessTokenEnc ? decryptString(cred.accessTokenEnc) : null,
    previous: previousUsable ? decryptString(cred!.previousAccessTokenEnc!) : null,
    previousValidUntil: previousUsable ? previousValidUntil : null,
  };
}

/** Constant-time check of `provided` against every currently accepted secret. */
export function signatureMatchesSecretSet(
  set: SecretSet,
  rawBody: string,
  provided: Buffer,
  now: number = Date.now()
): boolean {
  const candidates: string[] = [];
  if (set.current) candidates.push(set.current);
  if (set.previous && set.previousValidUntil !== null && set.previousValidUntil > now) {
    candidates.push(set.previous);
  }
  let ok = false;
  for (const secret of candidates) {
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    // No early return: every candidate is checked.
    if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
      ok = true;
    }
  }
  return ok;
}

export function invalidateSignatureSecretCache(
  clinicId: string,
  platform: "intake" | "pvs"
): void {
  secretCache.delete(cacheKey(clinicId, platform));
}

/**
 * Per-clinic HMAC-SHA256 verification for inbound webhooks.
 *
 * Two partitioned secrets per clinic, stored encrypted in
 * `platform_credentials`:
 *
 *   • `platform='intake'` — used by /api/leads/intake (clinic-landing
 *                           lead forms).
 *   • `platform='pvs'`    — used exclusively by /api/pvs/events,
 *                           /api/pvs/events/batch, and the GDT-Agent's
 *                           direct POST. Partitioned so a leak of the
 *                           intake secret does not give an attacker the
 *                           ability to forge PVS data (and vice versa) —
 *                           rotation can be done per-purpose.
 *
 * Wire format: `X-EINS-Signature: sha256=<hex>` over the raw request body.
 *
 * Use a fresh per-call cache (Map) if you need to check the same clinic
 * twice in one request; under normal load this hot-path runs once per
 * request and decrypt cost is negligible.
 */
export type SignaturePurpose = "leads" | "pvs";

/** Map purpose → platform_credentials row key. */
function platformForPurpose(p: SignaturePurpose): "intake" | "pvs" {
  return p === "pvs" ? "pvs" : "intake";
}

export async function verifyClinicSignature(
  clinicId: string,
  rawBody: string,
  signatureHeader: string | null,
  purpose: SignaturePurpose
): Promise<boolean> {
  if (!signatureHeader) return false;
  const match = signatureHeader.match(/^sha256=([0-9a-f]+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]!, "hex");
  if (provided.length !== 32) return false;

  const platform = platformForPurpose(purpose);
  const key = cacheKey(clinicId, platform);

  const cached = cacheGet(key);
  const entry = cached ?? cacheSet(key, await loadSecretSet(clinicId, platform));
  if (signatureMatchesSecretSet(entry.set, rawBody, provided)) return true;

  // A-18: the cache is per serverless instance. If another instance rotated
  // or created the secret, our cached copy is stale: re-read the row once
  // (throttled per key) before rejecting. Cached "no row" entries expire
  // after 2 s anyway and are not re-read here.
  if (
    cached &&
    cached.set.current !== null &&
    Date.now() - cached.loadedAt >= MISMATCH_RELOAD_MIN_INTERVAL_MS
  ) {
    const fresh = cacheSet(key, await loadSecretSet(clinicId, platform));
    return signatureMatchesSecretSet(fresh.set, rawBody, provided);
  }
  return false;
}

/**
 * Cheap existence check used by audit-categorization paths: did this clinic
 * ever set up an `intake` HMAC secret? Returns true if there's a row in
 * `platform_credentials(platform='intake')` for this clinic. Used by the
 * leads intake route to distinguish `bad_signature` (real clinic, wrong
 * key) from `forged_clinic` (clinic doesn't exist or never onboarded).
 *
 * Reuses the same TTL cache: a known-null entry means we already proved
 * absence within the cache window.
 */
export async function clinicHasIntakeSecret(clinicId: string): Promise<boolean> {
  const key = cacheKey(clinicId, "intake");
  const cached = cacheGet(key);
  if (cached !== undefined) return cached.set.current !== null;
  const [cred] = await db
    .select({ id: schema.platformCredentials.id })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, "intake")
      )
    )
    .limit(1);
  // Don't pollute the secret cache with a fake value — we use a sentinel
  // by checking the cache directly. The next verifyClinicSignature call
  // for a real signature attempt will populate the real secret.
  return Boolean(cred);
}

/**
 * Helper for the GDT-Agent enrollment flow: mint a per-clinic PVS HMAC
 * secret, store it encrypted in `platform_credentials.platform='pvs'`, and
 * return the plaintext to the caller (which surfaces it ONCE to the agent
 * via the enrollment response).
 *
 * Idempotency: existing 'pvs' rows are replaced — this is intentional, agent
 * re-enrollment rotates the secret and invalidates any previous installer.
 *
 * Atomicity contract (P0-1):
 *   • Accepts an optional `dbHandle` (defaults to the global `db`). Callers
 *     that need to compose this with other writes pass a Drizzle transaction
 *     so the mint + downstream writes either all commit or all roll back.
 *     Without this, a transient failure after the mint but before the
 *     consume/upsert would silently invalidate the previously-deployed
 *     secret (denial-of-service against the legitimate agent).
 *
 *   • This function NO LONGER invalidates the signature cache itself.
 *     The caller MUST call `invalidateSignatureSecretCache(clinicId, "pvs")`
 *     AFTER the surrounding transaction commits. Invalidating inside the tx
 *     opens a race where a concurrent verify reads the OLD secret from the
 *     DB (the tx's INSERT is not yet visible) and caches it — stranding the
 *     new secret for the cache TTL window.
 */
export interface MintPvsSecretResult {
  secretHex: string;
  rotated: boolean;
}

export type DbOrTx = typeof db;

export async function mintAndStorePvsSecret(
  clinicId: string,
  encryptStringFn: (plaintext: string) => Buffer,
  dbHandle: DbOrTx = db
): Promise<MintPvsSecretResult> {
  const { randomBytes } = await import("node:crypto");
  const secret = randomBytes(32).toString("hex");
  const enc = encryptStringFn(secret);

  // Upsert via insert + onConflictDoUpdate on (clinic_id, platform).
  const result = await dbHandle
    .insert(schema.platformCredentials)
    .values({
      clinicId,
      platform: "pvs",
      accessTokenEnc: enc,
    })
    .onConflictDoUpdate({
      target: [
        schema.platformCredentials.clinicId,
        schema.platformCredentials.platform,
      ],
      set: {
        accessTokenEnc: enc,
      },
    })
    .returning({ id: schema.platformCredentials.id });

  return {
    secretHex: secret,
    rotated: (result?.length ?? 0) > 0,
  };
}
