import { z } from "zod";
import { withApi, ApiError } from "@/server/api";
import { kpiSummary, kpiDailySeries } from "@/server/queries/kpis";

/**
 * GET /api/kpis
 *
 * Returns a KPI summary and (optionally) the daily series for a date range.
 *
 * Query params:
 *   from=YYYY-MM-DD
 *   to=YYYY-MM-DD
 *   series=1   → include daily rows
 *
 * Default range: last 30 days.
 */
const Query = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  series: z.enum(["0", "1"]).default("0"),
});

export const GET = withApi({ permission: "reports.view" }, async ({ session, request }) => {
  const url = new URL(request.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));

  const now = new Date();
  const from = q.from ? parseDay(q.from) : daysAgo(now, 30);
  const to = q.to ? parseDay(q.to) : now;

  if (!from || !to) {
    throw new ApiError(422, "validation", "Ungültiges Datum.");
  }
  if (from > to) {
    throw new ApiError(422, "validation", "`from` muss vor `to` liegen.");
  }
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw new ApiError(422, "validation", `Der Zeitraum darf höchstens ${MAX_RANGE_DAYS} Tage umfassen.`);
  }

  const [summary, series] = await Promise.all([
    kpiSummary(session.clinicId, session.userId, from, to),
    q.series === "1"
      ? kpiDailySeries(session.clinicId, session.userId, from, to)
      : Promise.resolve([]),
  ]);

  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    summary,
    ...(q.series === "1" ? { series } : {}),
  };
});

/** Two years: enough for any year-over-year view, bounds the series query. */
const MAX_RANGE_DAYS = 731;

/**
 * `YYYY-MM-DD` -> UTC midnight, or null for impossible dates. The regex lets
 * `2026-13-45` through (Invalid Date, then `toISOString()` threw a 500) and
 * `2026-02-30` (silently rolled over to 2 March); the round trip rejects both.
 */
function parseDay(s: string): Date | null {
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10) === s ? d : null;
}

function daysAgo(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}
