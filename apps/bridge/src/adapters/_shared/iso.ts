/**
 * Shared timestamp helpers for the Bucket B polling adapters (pabau, consentz).
 *
 * Tomedo keeps its own isoUtc in adapters/tomedo/event-identity.ts because that
 * copy is part of a documented cross-path dedup contract with the DB-read YAML;
 * the logic here is intentionally identical so all three polling adapters
 * normalise timestamps the same way.
 */

/**
 * Normalise a timestamp to canonical ISO-8601 UTC. Returns "" for empty/nullish
 * input and the raw value unchanged when it cannot be parsed (so a bad vendor
 * value surfaces downstream via the portal's Zod validation instead of being
 * silently rewritten or dropped).
 *
 *   isoUtc("2026-01-02T04:04:05+01:00") === "2026-01-02T03:04:05.000Z"
 *   isoUtc("2026-01-02T03:04:05Z")      === "2026-01-02T03:04:05.000Z"
 */
export function isoUtc(value: string | null | undefined): string {
  if (value == null || value === "") return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * Return the later of two cursor watermarks, normalised to ISO-8601 UTC.
 *
 * Both operands are normalised first so mixed offsets/precision from a vendor
 * API order chronologically instead of by raw lexical bytes (a "+01:00" string
 * sorts after a "Z" string of the SAME instant otherwise), and so the stored
 * cursor stays byte-stable across polls.
 *
 * A missing/empty candidate returns `current` unchanged: a row that lacks a
 * usable timestamp must never empty an existing cursor cell (which would reset
 * that stream's watermark to the epoch and re-download all history).
 */
export function pickMaxIso(
  current: string,
  candidate: string | null | undefined
): string {
  const cand = isoUtc(candidate);
  if (cand === "") return current;
  const cur = isoUtc(current);
  if (cur === "") return cand;
  return cur >= cand ? cur : cand;
}
