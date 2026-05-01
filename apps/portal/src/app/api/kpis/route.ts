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
  const from = q.from ? new Date(`${q.from}T00:00:00Z`) : daysAgo(now, 30);
  const to = q.to ? new Date(`${q.to}T00:00:00Z`) : now;

  if (from > to) {
    throw new ApiError(422, "validation", "`from` muss vor `to` liegen.");
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

function daysAgo(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - n);
  return d;
}
