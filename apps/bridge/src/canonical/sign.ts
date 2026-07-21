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

/**
 * Verify a plaintext secret that a FHIR server echoes back verbatim (H16).
 *
 * FHIR rest-hook Subscriptions replay the registered `channel.header` values
 * as-is on every delivery; they do NOT compute an HMAC over the body. The
 * bridge registers `x-<vendor>-secret: <secret>`, so the inbound handler must
 * compare the echoed header against the stored per-clinic secret with a
 * timing-safe, length-checked comparison (never `===`, which leaks length and
 * short-circuits on the first differing byte).
 */
export function verifyEchoedSecret(
  provided: string | null | undefined,
  expected: string
): boolean {
  if (!provided) return false;
  // Header whitespace after the colon is insignificant per HTTP; some FHIR
  // servers preserve a leading space when they replay channel.header.
  const a = Buffer.from(provided.trim(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
