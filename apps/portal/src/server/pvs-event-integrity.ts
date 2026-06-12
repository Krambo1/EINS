import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { deriveSigningKey } from "@/lib/crypto";

/**
 * Server-side integrity tag for stored `pvs_event_log` payloads (pentest H3).
 *
 * The admin "replay" tool re-applies a stored payload through the live ingest
 * pipeline. The original per-clinic wire HMAC cannot be re-verified there (the
 * agent secret rotates on re-enrollment), so to detect at-rest tampering we
 * compute our OWN HMAC over the canonical payload at ingest, keyed by a key
 * derived from SESSION_SECRET. That key never touches the database, so a
 * DB-only attacker who edits a stored row cannot also forge a matching tag.
 */

const INTEGRITY_CONTEXT = "pvs-event-integrity-v1";

/**
 * Recursively key-sorted canonical JSON. Sorting keys makes the tag invariant
 * to the JSONB round-trip (Postgres does not preserve object key order). For
 * the JSON-safe `PvsEvent` envelope (strings / ints / nested objects, no
 * Dates / bigints / undefined-distinct values) this yields byte-identical
 * output at ingest (over `input`) and at replay (over the round-tripped
 * `payload`), so verification never false-positives on an untampered row.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      out[k] = sortDeep(src[k]);
    }
    return out;
  }
  return v;
}

/** HMAC-SHA256(canonicalJson(payload)) under the derived integrity key, hex. */
export function computePvsEventIntegrityTag(payload: unknown): string {
  const key = Buffer.from(deriveSigningKey(INTEGRITY_CONTEXT));
  return createHmac("sha256", key).update(canonicalJson(payload)).digest("hex");
}

/** Constant-time check of a stored tag against a freshly computed one. */
export function verifyPvsEventIntegrityTag(
  payload: unknown,
  tag: string
): boolean {
  const expected = computePvsEventIntegrityTag(payload);
  if (expected.length !== tag.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(tag));
}
