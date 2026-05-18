import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { decryptString } from "@/lib/crypto";

/**
 * Per-clinic HMAC-SHA256 verification for inbound webhooks.
 *
 * Two partitioned secrets per clinic, stored encrypted in
 * `platform_credentials`:
 *
 *   • `platform='intake'` — shared by /api/leads/intake (clinic-landing)
 *                           and /api/patients/events (EINS Stimme).
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
export type SignaturePurpose = "leads" | "patients" | "pvs";

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

  const [cred] = await db
    .select({ accessTokenEnc: schema.platformCredentials.accessTokenEnc })
    .from(schema.platformCredentials)
    .where(
      and(
        eq(schema.platformCredentials.clinicId, clinicId),
        eq(schema.platformCredentials.platform, platform)
      )
    )
    .limit(1);
  if (!cred?.accessTokenEnc) return false;

  const secret = decryptString(cred.accessTokenEnc);
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}

/**
 * Helper for the GDT-Agent enrollment flow: mint a per-clinic PVS HMAC
 * secret, store it encrypted in `platform_credentials.platform='pvs'`, and
 * return the plaintext to the caller (which surfaces it ONCE to the agent
 * via the enrollment response).
 *
 * Idempotency: existing 'pvs' rows are replaced — this is intentional, agent
 * re-enrollment rotates the secret and invalidates any previous installer.
 */
export interface MintPvsSecretResult {
  secretHex: string;
  rotated: boolean;
}

export async function mintAndStorePvsSecret(
  clinicId: string,
  encryptStringFn: (plaintext: string) => Buffer
): Promise<MintPvsSecretResult> {
  const { randomBytes } = await import("node:crypto");
  const secret = randomBytes(32).toString("hex");
  const enc = encryptStringFn(secret);

  // Upsert via insert + onConflictDoUpdate on (clinic_id, platform).
  const result = await db
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
