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
export function isoUtc(
  value: string | null | undefined,
  timezone?: string
): string {
  if (value == null || value === "") return "";
  if (timezone) {
    const wall = parseZonelessWallClock(value);
    if (wall) {
      const ms = wallClockToUtcMs(wall, timezone);
      if (ms != null) return new Date(ms).toISOString();
    }
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toISOString();
}

/** The default zone for vendor timestamps that carry no UTC offset. All EINS
 *  Praxen are DACH clinics; a Pabau/Consentz/Tomedo row without a zone is
 *  wall-clock time in the Praxis, not UTC. Per-link override:
 *  connection_config.timezone. */
export const DEFAULT_TIMEZONE = "Europe/Berlin";

/** Options every normalizer accepts. */
export interface NormalizeOptions {
  /** IANA zone applied to vendor timestamps that carry no UTC offset.
   *  Default Europe/Berlin. */
  timezone?: string;
}

/** Resolve a link's IANA zone: connection_config.timezone when it is a valid
 *  zone name, else Europe/Berlin. Never throws. */
export function resolveTimezone(connectionConfig: unknown): string {
  const raw = (connectionConfig as { timezone?: unknown } | null)?.timezone;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: raw.trim() });
      return raw.trim();
    } catch {
      /* invalid zone name: fall through to the default */
    }
  }
  return DEFAULT_TIMEZONE;
}

interface WallClock {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
}

const ZONELESS_RE =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

/** Parse "YYYY-MM-DD[T ]HH:mm[:ss[.fff]]" with NO zone designator, else null. */
function parseZonelessWallClock(value: string): WallClock | null {
  const m = ZONELESS_RE.exec(value.trim());
  if (!m) return null;
  return {
    y: Number(m[1]),
    mo: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4]),
    mi: Number(m[5]),
    s: m[6] ? Number(m[6]) : 0,
    ms: m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0,
  };
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timezone, f);
  }
  return f;
}

/** Offset of `timezone` from UTC at the instant `utcMs`, in ms (CET = +3_600_000). */
function zoneOffsetMs(utcMs: number, timezone: string): number {
  const parts = formatterFor(timezone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Convert a wall-clock reading in `timezone` to a UTC instant (ms), using only
 * Intl offsets (no tz library). Two passes settle the offset across a DST
 * boundary. For the spring-forward gap (a wall time that never existed) and the
 * autumn overlap (a wall time that happened twice) the result is a consistent,
 * deterministic instant, which is all dedup stability needs.
 */
function wallClockToUtcMs(w: WallClock, timezone: string): number | null {
  try {
    const guess = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s, w.ms);
    if (Number.isNaN(guess)) return null;
    const off1 = zoneOffsetMs(guess, timezone);
    let utc = guess - off1;
    const off2 = zoneOffsetMs(utc, timezone);
    if (off2 !== off1) utc = guess - off2;
    return utc;
  } catch {
    return null;
  }
}

/** ISO string of `iso` shifted by `deltaMs`; returns `iso` unchanged if unparseable. */
export function shiftIso(iso: string, deltaMs: number): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t + deltaMs).toISOString();
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
