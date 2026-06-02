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

const dateFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

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
 * Day-granularity relative label, anchored on local midnight. Used for
 * forward-looking action lists (touchpoints, review-request schedule) where
 * "Heute" / "Morgen" / "in 4 Tagen" reads faster than an absolute
 * `22.5.2026`. Past dates collapse
 * to "Überfällig" with the day count surfaced via `overdueDays` so callers can
 * decide whether to show "vor 3 Tagen" or just paint the row red.
 *
 * Note: parses `YYYY-MM-DD` strings as local-midnight (not UTC) so day math
 * never drifts across the timezone boundary for German users.
 */
export function formatRelativeDay(
  value: string | Date | null | undefined
): { label: string; diffDays: number; overdue: boolean } {
  if (!value) return { label: "–", diffDays: 0, overdue: false };
  let target: Date;
  if (typeof value === "string") {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    target = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(value);
  } else {
    target = new Date(value);
  }
  if (Number.isNaN(target.getTime())) {
    return { label: "–", diffDays: 0, overdue: false };
  }
  target.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / 86_400_000
  );
  if (diffDays < 0) {
    return { label: "Überfällig", diffDays, overdue: true };
  }
  if (diffDays === 0) return { label: "Heute", diffDays, overdue: false };
  if (diffDays === 1) return { label: "Morgen", diffDays, overdue: false };
  return { label: `in ${diffDays} Tagen`, diffDays, overdue: false };
}

/** "Für jeden Euro kommen 2,50 € zurück" — Opa-proof ROAS translation. */
export function formatRoasSentence(roas: number | null | undefined): string {
  if (roas == null || Number.isNaN(roas) || roas <= 0) {
    return "Noch zu wenig Daten für eine Aussage.";
  }
  return `Für jeden Euro Werbeausgabe kommen ${formatEuro(roas, { decimal: true })} zurück.`;
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

/** "23 Min", "4,5 Std" — readable response-time formatting. */
export function formatMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "–";
  if (value < 60) return `${Math.round(value)} Min`;
  if (value < 60 * 24) return `${(value / 60).toFixed(1).replace(".", ",")} Std`;
  return `${(value / 60 / 24).toFixed(1).replace(".", ",")} Tage`;
}

/** Format a percentage delta (e.g. 0.12 → "+12,0 %"). */
export function formatDeltaPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const pct = value * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1).replace(".", ",")} %`;
}
