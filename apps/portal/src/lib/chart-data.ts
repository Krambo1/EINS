import type { TrendChartPoint } from "@eins/ui";
import type { DashboardRange } from "./dashboard-range";

/**
 * Zip parallel `dates` + `values` arrays into the `{ date, value }` shape
 * expected by `<TrendChart>`. Used everywhere we feed the interactive chart
 * from a `KpiSparklines`-style server payload.
 *
 * The two arrays must be the same length; if `values` is shorter we trim
 * `dates` to match (which is what the legacy `slice(-N)` callers want).
 */
export function zipSeries(
  dates: readonly string[],
  values: readonly number[]
): TrendChartPoint[] {
  const len = Math.min(dates.length, values.length);
  // Align to the tail when `values` is a `.slice(-N)` view of a longer series.
  const dateOffset = dates.length - len;
  const valueOffset = values.length - len;
  const out: TrendChartPoint[] = new Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = { date: dates[i + dateOffset], value: values[i + valueOffset] };
  }
  return out;
}

/**
 * Zip a single dated-row series (one of our `Array<{ date, ... }>` shapes)
 * into TrendChartPoints by extracting one numeric field via accessor.
 */
export function mapSeries<T extends { date: string }>(
  rows: readonly T[],
  pick: (row: T) => number
): TrendChartPoint[] {
  return rows.map((r) => ({ date: r.date, value: pick(r) }));
}

/**
 * Points per dashboard line by period. A day per point reads well up to
 * 30 Tage; over 12 Monate or 5 Jahre most days are 0 and the line turns into
 * spikes, so those days are summed into steps of a week or a month.
 */
const RANGE_POINTS: Partial<Record<DashboardRange, number>> = {
  jahr: 52,
  max: 60,
};

/** "23.–29. Okt. 2025" (dates are Berlin day keys, formatted as UTC days). */
const stepRangeFormat = new Intl.DateTimeFormat("de-DE", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dayKeyToDate(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

/**
 * Cuts `length` days into `parts` runs of whole days, as equal as possible.
 * The oldest runs take the spare days, so the newest point is always a full
 * week or month ending today and the line never dips at its end. The period
 * before has the same length, so its runs line up point for point.
 */
function dayRuns(length: number, parts: number): Array<[from: number, to: number]> {
  const base = Math.floor(length / parts);
  let spare = length - base * parts;
  const runs: Array<[number, number]> = [];
  for (let from = 0; from < length; ) {
    const to = from + base + (spare > 0 ? 1 : 0);
    if (spare > 0) spare--;
    runs.push([from, to]);
    from = to;
  }
  return runs;
}

/**
 * A dashboard line for one period from a dense day series: one point per day
 * up to 30 Tage, one per week (12 Monate) or month (5 Jahre) beyond. Each
 * grouped point is the sum of its days and names them in the tooltip.
 */
export function rangeSeries(
  dates: readonly string[],
  values: readonly number[],
  range: DashboardRange
): TrendChartPoint[] {
  return rangeSeriesBy(dates, range, (from, to) => sumOf(values, from, to));
}

/**
 * Like `rangeSeries` for a ratio such as Werbeertrag: each grouped point
 * divides the summed numerator by the summed denominator (0 without any).
 */
export function rangeRatioSeries(
  dates: readonly string[],
  numerator: readonly number[],
  denominator: readonly number[],
  range: DashboardRange
): TrendChartPoint[] {
  return rangeSeriesBy(dates, range, (from, to) => {
    const den = sumOf(denominator, from, to);
    return den > 0 ? Number((sumOf(numerator, from, to) / den).toFixed(2)) : 0;
  });
}

/** Tick format for a period's line: the year matters once it spans years. */
export function rangeTickFormat(range: DashboardRange): "day" | "month" {
  return range === "max" ? "month" : "day";
}

function rangeSeriesBy(
  dates: readonly string[],
  range: DashboardRange,
  valueOf: (from: number, to: number) => number
): TrendChartPoint[] {
  const parts = RANGE_POINTS[range];
  if (!parts || dates.length <= parts) {
    return dates.map((date, i) => ({ date, value: valueOf(i, i + 1) }));
  }
  return dayRuns(dates.length, parts).map(([from, to]) => ({
    date: dates[from]!,
    value: valueOf(from, to),
    label: stepRangeFormat.formatRange(dayKeyToDate(dates[from]!), dayKeyToDate(dates[to - 1]!)),
  }));
}

function sumOf(values: readonly number[], from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i] ?? 0;
  return sum;
}
