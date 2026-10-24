import type { TrendChartPoint } from "@eins/ui";

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
