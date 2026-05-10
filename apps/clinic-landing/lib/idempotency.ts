import { createHash, randomUUID } from "node:crypto";

/**
 * Idempotency hash used for two purposes:
 *   1. Drop double-submits inside the same day (browser retries, network blips)
 *   2. Provide a stable `event_id` for Meta CAPI ↔ Pixel deduplication
 *
 * Same email + treatment + day = same hash. Different ad campaign within the
 * same day still dedups, which is the correct behavior — one human, one lead.
 */
export function idempotencyKey(email: string, treatmentSlug: string): string {
  const dayUTC = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return createHash("sha256")
    .update(`${email.trim().toLowerCase()}|${treatmentSlug}|${dayUTC}`)
    .digest("hex");
}

export function newEventId(): string {
  // Browser sends one of these; server reuses it for CAPI dedup.
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : randomUUID();
}
