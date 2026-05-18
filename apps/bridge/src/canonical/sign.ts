import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signature over a raw body, formatted as `sha256=<hex>`.
 * Matches the portal's verifyClinicSignature wire format exactly.
 */
export function signBody(rawBody: string, secretHex: string): string {
  const sig = createHmac("sha256", secretHex).update(rawBody).digest("hex");
  return `sha256=${sig}`;
}

/**
 * Verify an inbound signature (used by the bridge's inbound webhooks for
 * vendor-side outbound signature checks — HealthHub + RED both sign their
 * webhook payloads with vendor-specific keys).
 */
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string
): boolean {
  if (!signatureHeader) return false;
  const m = signatureHeader.match(/^sha256=([0-9a-f]+)$/i);
  if (!m) return false;
  const provided = Buffer.from(m[1]!, "hex");
  if (provided.length !== 32) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
