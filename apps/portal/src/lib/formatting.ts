/**
 * German-locale formatters. All UI goes through these so we never
 * manually concat "€" or "%", and tabular-nums rendering works.
 */

export type CurrencyCode = "EUR" | "CHF";

// One Intl currency formatter per (currency, decimal) combination, built
// lazily. The locale stays de-DE for every currency so the thousands/decimal
// separators match the rest of the German UI; only the symbol changes
// ("1.234 CHF"). PVS revenue can be EUR (DE/AT) or CHF (CH); agency-side money
// is always EUR.
const currencyFormatterCache = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  currency: CurrencyCode,
  decimal: boolean
): Intl.NumberFormat {
  const key = `${currency}:${decimal ? "d" : "i"}`;
  let f = currencyFormatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency,
      ...(decimal
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : { maximumFractionDigits: 0 }),
    });
    currencyFormatterCache.set(key, f);
  }
  return f;
}

const numberFormatter = new Intl.NumberFormat("de-DE");

const percentFormatter = new Intl.NumberFormat("de-DE", {
  style: "percent",
  maximumFractionDigits: 1,
});

// Every Praxis is in DACH, but the server (Vercel) runs in UTC. Without an
// explicit zone a 23:30 Anfrage renders as 21:30 on the server and 23:30 in
// the browser (wrong time + hydration mismatch). Pin all display formatting
// to Berlin wall time.
export const DISPLAY_TIME_ZONE = "Europe/Berlin";

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: DISPLAY_TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
});

// en-CA formats as YYYY-MM-DD, which makes the Berlin calendar date of any
// instant a plain string compare/parse.
const berlinIsoDateFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: DISPLAY_TIME_ZONE,
});

/** Berlin calendar date ("YYYY-MM-DD") of an instant. */
export function berlinDateString(d: Date = new Date()): string {
  return berlinIsoDateFormatter.format(d);
}

const relativeTimeFormatter = new Intl.RelativeTimeFormat("de-DE", {
  numeric: "auto",
});

/**
 * Format an amount in the given currency (default EUR). Use this wherever the
 * value can be CHF (PVS revenue from a Swiss Praxis); pass the clinic's
 * currency. `formatEuro` is the EUR-only shorthand for the many call sites that
 * are always EUR (agency-side spend, ROAS, etc.).
 */
export function formatMoney(
  value: number | null | undefined,
  currency: CurrencyCode = "EUR",
  options?: { decimal?: boolean }
): string {
  if (value == null || Number.isNaN(value)) return "–";
  return currencyFormatter(currency, options?.decimal ?? false).format(value);
}

export function formatEuro(value: number | null | undefined, options?: { decimal?: boolean }): string {
  return formatMoney(value, "EUR", options);
}

/**
 * Format a revenue figure that SUMS across multiple Praxen (admin cross-clinic
 * totals). Such a sum only has a meaningful currency when every contributing
 * Praxis bills in the same one: you cannot add CHF to EUR. Pass the distinct
 * currencies present in the summed set.
 *
 * - exactly one currency → format the value in it (the all-EUR case today, and
 *   the all-CHF case once a Swiss cohort exists);
 * - more than one (EUR + CHF mix) → return `mixedLabel` ("gemischt" by default)
 *   instead of a wrong number;
 * - empty set → treated as EUR (nothing summed, value is 0).
 *
 * Per-row revenue (one Praxis per row) should use `formatMoney` with that row's
 * own currency, not this helper. Phase 11.
 */
export function formatClinicAggregate(
  value: number | null | undefined,
  currencies: Iterable<CurrencyCode | string>,
  options?: { mixedLabel?: string; decimal?: boolean }
): string {
  const distinct = new Set<string>();
  for (const c of currencies) distinct.add(c);
  if (distinct.size > 1) return options?.mixedLabel ?? "gemischt";
  const only = (distinct.values().next().value ?? "EUR") as CurrencyCode;
  return formatMoney(value, only, { decimal: options?.decimal });
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return numberFormatter.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  return percentFormatter.format(value);
}

/** File size for upload lists: "512 B", "40 KB", "3.4 MB", "1.25 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  return dateFormatter.format(d);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  return dateTimeFormatter.format(d);
}

/** "vor 3 Stunden", "gestern", "vor 5 Tagen" */
export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "–";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "–";
  const diffMs = d.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const abs = Math.abs(diffMin);

  if (abs < 60) return relativeTimeFormatter.format(diffMin, "minute");
  if (abs < 60 * 24) return relativeTimeFormatter.format(Math.round(diffMin / 60), "hour");
  if (abs < 60 * 24 * 14) return relativeTimeFormatter.format(Math.round(diffMin / 60 / 24), "day");
  return formatDate(d);
}

/**
 * Day-granularity relative label, anchored on Berlin midnight. Used for
 * forward-looking action lists (touchpoints, review-request schedule) where
 * "Heute" / "Morgen" / "in 4 Tagen" reads faster than an absolute
 * `22.5.2026`. Past dates collapse
 * to "Überfällig" with the day count surfaced via `overdueDays` so callers can
 * decide whether to show "vor 3 Tagen" or just paint the row red.
 *
 * Note: `YYYY-MM-DD` strings are taken as Berlin calendar dates and instants
 * are converted to their Berlin date, so day math never drifts on a UTC server.
 */
export function formatRelativeDay(
  value: string | Date | null | undefined
): { label: string; diffDays: number; overdue: boolean } {
  if (!value) return { label: "–", diffDays: 0, overdue: false };
  // Compare Berlin calendar days, not server-local midnights: on a UTC
  // server "today" otherwise flips at 01:00/02:00 Berlin time.
  let targetIso: string;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    targetIso = value.slice(0, 10);
  } else {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) {
      return { label: "–", diffDays: 0, overdue: false };
    }
    targetIso = berlinDateString(d);
  }
  const toUtcDay = (iso: string) =>
    Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  const diffDays = Math.round(
    (toUtcDay(targetIso) - toUtcDay(berlinDateString())) / 86_400_000
  );
  if (diffDays < 0) {
    return { label: "Überfällig", diffDays, overdue: true };
  }
  if (diffDays === 0) return { label: "Heute", diffDays, overdue: false };
  if (diffDays === 1) return { label: "Morgen", diffDays, overdue: false };
  return { label: `in ${diffDays} Tagen`, diffDays, overdue: false };
}

/** Traffic-light tone from a goal ratio (current/target). */
export function toneForGoalRatio(
  ratio: number
): "good" | "warn" | "bad" | "neutral" {
  if (!Number.isFinite(ratio)) return "neutral";
  if (ratio >= 0.9) return "good";
  if (ratio >= 0.6) return "warn";
  if (ratio >= 0.3) return "neutral";
  return "bad";
}

/** Tone for a period-over-period delta. `inverse` flips good/bad (e.g. spend, where lower is better). */
export function deltaTone(
  pct: number | null,
  inverse = false
): "good" | "warn" | "bad" | "neutral" {
  if (pct == null) return "neutral";
  const positive = pct > 0.05;
  const negative = pct < -0.05;
  if (positive) return inverse ? "bad" : "good";
  if (negative) return inverse ? "good" : "bad";
  return "neutral";
}
