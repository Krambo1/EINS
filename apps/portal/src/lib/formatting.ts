/**
 * German-locale formatters. All UI goes through these so we never
 * manually concat "€" or "%", and tabular-nums rendering works.
 */

const euroFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const euroFormatterDecimal = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

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

export function formatEuro(value: number | null | undefined, options?: { decimal?: boolean }): string {
  if (value == null || Number.isNaN(value)) return "–";
  return (options?.decimal ? euroFormatterDecimal : euroFormatter).format(value);
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
 * forward-looking action lists (touchpoints, recalls) where "Heute" / "Morgen"
 * / "in 4 Tagen" reads faster than an absolute `22.5.2026`. Past dates collapse
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
  if (ratio >= 1) return "good";
  if (ratio >= 0.7) return "warn";
  if (ratio >= 0.4) return "neutral";
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
