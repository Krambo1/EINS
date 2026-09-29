import { createHmac } from "node:crypto";

/**
 * Pseudonymous viewer id: HMAC(key, day | ip | ua). Same device on the same
 * UTC day → same hash, so "unique viewers" means something; a new day or a
 * different device → a different hash. The IP itself is never stored, and
 * without the key the hash cannot be matched back to an IP.
 */
export function viewerHash(
  key: Uint8Array,
  ip: string | null,
  ua: string | null,
  at: Date
): string {
  const day = at.toISOString().slice(0, 10);
  return createHmac("sha256", key)
    .update(`${day}|${ip ?? "-"}|${ua ?? "-"}`)
    .digest("base64url")
    .slice(0, 22);
}
