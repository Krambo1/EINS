import { berlinWallClockToUtcMs } from "../berlin-time.js";
import type {
  CursorFormat,
  DbTimezone,
  StreamConfig,
  VendorConfig,
} from "./types.js";

/**
 * Cursor / clock helpers for the SQL-introspection framework.
 *
 * VOCABULARY. Every timestamp cursor is handled as "domain milliseconds": the
 * value of the cursor column expressed as ms since 1970 in the DATABASE'S OWN
 * CLOCK. For a zone-less TIMESTAMP in a German PVS that is the Berlin wall clock
 * read as if it were UTC (exactly what node drivers produce while the process
 * runs with TZ=UTC, see tz-pin.ts). For an epoch column or a real timestamptz it
 * is the true UTC instant. Comparing and binding the cursor in the DB's own
 * terms is what keeps `modified_at > :cursor` correct; only EMITTED timestamps
 * are converted to real instants (normalizer.ts).
 */

export const DEFAULT_LOOKBACK_MINUTES = 30;
export const DEFAULT_INITIAL_HORIZON_DAYS = 90;
export const DEFAULT_TIMEZONE: DbTimezone = "Europe/Berlin";
/** A cursor may run at most this far ahead of the DB clock before it is clamped. */
export const FUTURE_CURSOR_TOLERANCE_MS = 10 * 60_000;

const DAY_MS = 86_400_000;
const JULIAN_UNIX_EPOCH = 2440587.5;

// ---------- effective per-stream settings ---------------------------------

export function timezoneOf(vendor: VendorConfig, stream: StreamConfig): DbTimezone {
  return stream.timezone ?? vendor.timezone ?? DEFAULT_TIMEZONE;
}

export function cursorFormatOf(
  vendor: VendorConfig,
  stream: StreamConfig
): CursorFormat {
  return (
    stream.cursorFormat ??
    vendor.cursorFormat ??
    (vendor.driver === "sqlite" ? "iso_text" : "native")
  );
}

export function initialHorizonDaysOf(
  vendor: VendorConfig,
  stream: StreamConfig
): number {
  return (
    stream.initialHorizonDays ??
    vendor.initialHorizonDays ??
    DEFAULT_INITIAL_HORIZON_DAYS
  );
}

export function configuredLookbackMs(
  vendor: VendorConfig,
  stream: StreamConfig
): number {
  const minutes =
    stream.lookbackMinutes ?? vendor.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES;
  return Math.max(0, minutes) * 60_000;
}

// ---------- clocks --------------------------------------------------------

const berlinFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** The Berlin wall clock at real instant `utcMs`, as "naive" ms (wall clock read
 *  as UTC). */
export function berlinWallClockMs(utcMs: number): number {
  const parts = berlinFormatter.formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return (
    Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour") % 24,
      get("minute"),
      get("second")
    ) + (((utcMs % 1000) + 1000) % 1000)
  );
}

/** True when the cursor column carries a zone-less wall clock (as opposed to an
 *  absolute instant: epoch numbers, 'Z' text, timestamptz). */
export function cursorIsWallClock(
  format: CursorFormat,
  timezone: DbTimezone
): boolean {
  if (timezone === "utc") return false;
  return format === "native" || format === "iso_text";
}

/** "Now" in the cursor column's own clock. */
export function domainNowMs(
  realNowMs: number,
  format: CursorFormat,
  timezone: DbTimezone
): number {
  return cursorIsWallClock(format, timezone)
    ? berlinWallClockMs(realNowMs)
    : realNowMs;
}

/**
 * True when `domainMs` (a Berlin wall clock) lies within an hour of a DST
 * transition. The fall-back hour (02:00-03:00 occurs twice) makes a wall-clock
 * cursor jump BACKWARDS by an hour in real time: rows written during the second
 * pass carry modified_at values below a cursor that already reached 02:59. A
 * lookback of at least 65 minutes around the transition re-reads them.
 */
export function nearDstTransition(domainMs: number): boolean {
  const probe = (ms: number): boolean => {
    const x = new Date(ms);
    const a = berlinWallClockToUtcMs(
      x.getUTCFullYear(),
      x.getUTCMonth() + 1,
      x.getUTCDate(),
      x.getUTCHours(),
      x.getUTCMinutes(),
      x.getUTCSeconds()
    );
    const y = new Date(ms + 3_600_000);
    const b = berlinWallClockToUtcMs(
      y.getUTCFullYear(),
      y.getUTCMonth() + 1,
      y.getUTCDate(),
      y.getUTCHours(),
      y.getUTCMinutes(),
      y.getUTCSeconds()
    );
    return a === null || b === null || b - a !== 3_600_000;
  };
  return probe(domainMs) || probe(domainMs - 3_600_000);
}

// ---------- cursor value <-> domain ms ------------------------------------

const TEXT_TS =
  /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * A raw cursor-column value as domain ms, or null when it is not a usable
 * timestamp (NULL, Invalid Date, garbage text). Strings without an explicit
 * zone are read as a wall clock (UTC fields); strings with Z/offset are real
 * instants.
 */
export function parseCursorValue(
  value: unknown,
  format: CursorFormat
): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof value === "bigint") value = Number(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    switch (format) {
      case "epoch_s":
        return Math.round(value * 1000);
      case "epoch_ms":
        return Math.round(value);
      case "julian":
        return Math.round((value - JULIAN_UNIX_EPOCH) * DAY_MS);
      default:
        return null;
    }
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    // Numeric text in an epoch/julian column.
    return parseCursorValue(Number(s), format);
  }
  const m = TEXT_TS.exec(s);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", sec = "0", frac = "", zone] = m;
  const ms = frac ? Math.round(Number(`0.${frac}`) * 1000) : 0;
  const base = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
    ms
  );
  if (Number.isNaN(base)) return null;
  if (!zone || zone === "Z") return base;
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  const offMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2) || "0");
  return base - sign * offMin * 60_000;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** 'YYYY-MM-DD HH:MM:SS' of a domain ms (seconds floored). */
export function formatIsoText(ms: number): string {
  const d = new Date(Math.floor(ms / 1000) * 1000);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

/** The value to bind for :cursor so it compares correctly against a column
 *  stored in `format`. */
export function formatCursorBind(
  ms: number,
  format: CursorFormat
): string | number | Date {
  switch (format) {
    case "native":
      return new Date(ms);
    case "iso_text":
      return formatIsoText(ms);
    case "iso_t_text":
      return new Date(ms).toISOString();
    case "epoch_s":
      return Math.floor(ms / 1000);
    case "epoch_ms":
      return Math.floor(ms);
    case "julian":
      return ms / DAY_MS + JULIAN_UNIX_EPOCH;
  }
}

/**
 * Does a raw cursor-column sample match the configured format? Returns null
 * when it does, else a short description of what was found. Used on the first
 * poll to halt LOUDLY on a text-vs-epoch (or 'T' vs ' ') mismatch instead of
 * silently comparing across storage classes.
 */
export function describeCursorFormatMismatch(
  sample: unknown,
  format: CursorFormat
): string | null {
  if (sample === null || sample === undefined) return null;
  switch (format) {
    case "native":
      if (sample instanceof Date) return null;
      if (typeof sample === "string" && TEXT_TS.test(sample.trim())) return null;
      return `${typeof sample} value '${String(sample).slice(0, 40)}'`;
    case "iso_text":
      if (
        typeof sample === "string" &&
        /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?/.test(sample)
      ) {
        return null;
      }
      return typeof sample === "string"
        ? `text '${sample.slice(0, 40)}'`
        : `${typeof sample} '${String(sample).slice(0, 40)}'`;
    case "iso_t_text":
      if (typeof sample === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(sample)) {
        return null;
      }
      return typeof sample === "string"
        ? `text '${sample.slice(0, 40)}'`
        : `${typeof sample} '${String(sample).slice(0, 40)}'`;
    case "epoch_s":
    case "epoch_ms":
    case "julian":
      if (typeof sample === "number" || typeof sample === "bigint") return null;
      return `${typeof sample === "string" ? "text" : typeof sample} '${String(
        sample
      ).slice(0, 40)}'`;
  }
}
