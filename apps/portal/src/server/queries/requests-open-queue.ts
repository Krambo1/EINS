/**
 * Pure sweep behind `openQueueDailyInRangeWithComparison` (D-8 / F-24),
 * which also backs the dashboard's `openQueueDaily`.
 *
 * "Open" at instant T means: the Anfrage existed at T and its status at T
 * was `neu`. The status at T is the status before the earliest status
 * change strictly after T, or the current status when no later change
 * exists (robust to seed rows inserted in a terminal status without a
 * logged change). Every Anfrage contributes its `neu` intervals once and
 * the per-point counts come from a difference array.
 *
 * Reading of a `status_change` row (decided 2026-10-07, see
 * docs/portal-review/fixes/FX-M.md):
 *   - new status = meta.to ?? meta.derivedStatus (older PVS rows only carry
 *     derivedStatus); a row with none of from / to / derivedStatus is no
 *     status change (e.g. "PVS: Umsatz entfernt") and is ignored;
 *   - status before = meta.from, else the new status of the previous status
 *     change of the same Anfrage (however old), else 'neu' (every Anfrage
 *     starts as neu).
 */

import { berlinDateString } from "@/lib/formatting";
import { berlinMidnight } from "@/lib/werkstunden";

type IsoDay = Parameters<typeof berlinMidnight>[0];

/** "YYYY-MM-DD" of the day after `iso`. */
function nextIsoDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * Sample points for the open-queue series: every Berlin calendar day from
 * the day of `from` to the day of `to`, the last millisecond of each of
 * those days (23 or 25 hours long across a DST switch), and the last
 * millisecond before the first day (comparison anchor). `from` may be any
 * instant of its day; the cache keys it by Berlin day.
 */
export function openQueuePoints(
  from: Date,
  to: Date
): { dates: string[]; priorAt: number; dayEnds: number[] } {
  const dates: string[] = [];
  const end = berlinDateString(to);
  for (let d = berlinDateString(from); d <= end; d = nextIsoDay(d)) dates.push(d);
  const dayEnds = dates.map((d) => berlinMidnight(nextIsoDay(d) as IsoDay).getTime() - 1);
  const priorAt = berlinMidnight(berlinDateString(from) as IsoDay).getTime() - 1;
  return { dates, priorAt, dayEnds };
}

export interface SweepRequest {
  id: string;
  createdAt: number;
  status: string;
}

export interface SweepChange {
  requestId: string;
  createdAt: number;
  /** meta.from */
  from: string | null;
  /** New status: meta.to ?? meta.derivedStatus. */
  to: string | null;
  /**
   * New status of the status change right before this one (SQL `LAG` over
   * all changes of the Anfrage, also those older than the window). Only
   * read on the first change of an Anfrage in `changes`; later ones take
   * the `to` of their predecessor in the list.
   */
  prevTo?: string | null;
}

/** Status before `c`, given the new status of the change before it. */
export function statusBefore(c: Pick<SweepChange, "from">, prevTo: string | null | undefined): string {
  return c.from ?? prevTo ?? "neu";
}

/** True when the row carries any status information (else ignored). */
function isStatusChange(c: SweepChange): boolean {
  return c.from != null || c.to != null;
}

/** First index i with points[i] >= t (points sorted ascending). */
function lowerBound(points: number[], t: number): number {
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]! < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Count of Anfragen open at each point. `points` must be sorted ascending.
 * `changes` only needs the status changes after `points[0]` (in order of
 * created_at, id; ties keep that order); for earlier ones only the `prevTo`
 * of the first later change matters.
 */
export function openCountsAtPoints(
  points: number[],
  requests: SweepRequest[],
  changes: SweepChange[]
): number[] {
  const diff = new Array<number>(points.length + 1).fill(0);
  if (points.length === 0) return [];

  const byRequest = new Map<string, SweepChange[]>();
  for (const c of changes) {
    if (!isStatusChange(c)) continue;
    const list = byRequest.get(c.requestId);
    if (list) list.push(c);
    else byRequest.set(c.requestId, [c]);
  }

  const addInterval = (start: number, end: number) => {
    // Points p with start <= p < end.
    if (end <= start) return;
    const i = lowerBound(points, start);
    const j = lowerBound(points, end);
    if (i < j) {
      diff[i]! += 1;
      diff[j]! -= 1;
    }
  };

  for (const r of requests) {
    const list = (byRequest.get(r.id) ?? []).sort((a, b) => a.createdAt - b.createdAt);
    let segStart = -Infinity;
    let prevTo = list[0]?.prevTo ?? null;
    for (const c of list) {
      // Status during [segStart, c.createdAt) is the status before this change.
      if (statusBefore(c, prevTo) === "neu") {
        addInterval(Math.max(segStart, r.createdAt), c.createdAt);
      }
      segStart = c.createdAt;
      prevTo = c.to;
    }
    if (r.status === "neu") addInterval(Math.max(segStart, r.createdAt), Infinity);
  }

  const out: number[] = [];
  let running = 0;
  for (let k = 0; k < points.length; k++) {
    running += diff[k]!;
    out.push(running);
  }
  return out;
}
