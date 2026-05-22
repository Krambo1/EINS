import "server-only";
import {
  and,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { RequestStatus } from "@/lib/constants";
import { avatarUrlForKey } from "@/server/avatars";
import { invalidateNavBadges } from "./navBadgesCache";

/**
 * Read helpers for the Anfragen inbox and detail views.
 * All calls run inside withClinicContext → RLS-enforced.
 */

export interface RequestListItem {
  id: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  treatmentWish: string | null;
  treatmentId: string | null;
  treatmentName: string | null;
  source: string;
  status: RequestStatus;
  aiScore: number | null;
  aiCategory: string | null;
  slaRespondBy: Date | null;
  firstContactedAt: Date | null;
  createdAt: Date;
  assignedTo: string | null;
}

export interface RequestListFilters {
  status?: RequestStatus[];
  source?: string[];
  aiCategory?: ("hot" | "warm" | "cold")[];
  treatmentId?: string[];
  search?: string;
  assignedTo?: string | "unassigned" | null;
  slaBreachedOnly?: boolean;
  /** When true, only return rows with no activity in the last 14 days. */
  staleOnly?: boolean;
}

/**
 * Paginated list for the inbox. Default sort: SLA first, then newest.
 */
export async function listRequests(
  clinicId: string,
  userId: string,
  filters: RequestListFilters = {},
  opts: { limit?: number; offset?: number } = {}
): Promise<{ items: RequestListItem[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  return withClinicContext(clinicId, userId, async (tx) => {
    const predicates = [eq(schema.requests.clinicId, clinicId)];

    if (filters.status?.length) {
      predicates.push(inArray(schema.requests.status, filters.status));
    }
    if (filters.source?.length) {
      predicates.push(inArray(schema.requests.source, filters.source));
    }
    if (filters.aiCategory?.length) {
      predicates.push(inArray(schema.requests.aiCategory, filters.aiCategory));
    }
    if (filters.treatmentId?.length) {
      predicates.push(inArray(schema.requests.treatmentId, filters.treatmentId));
    }
    if (filters.search) {
      const term = `%${filters.search}%`;
      predicates.push(
        or(
          ilike(schema.requests.contactName, term),
          ilike(schema.requests.contactEmail, term),
          ilike(schema.requests.contactPhone, term),
          ilike(schema.requests.treatmentWish, term)
        )!
      );
    }
    if (filters.assignedTo === "unassigned") {
      predicates.push(isNull(schema.requests.assignedTo));
    } else if (filters.assignedTo) {
      predicates.push(eq(schema.requests.assignedTo, filters.assignedTo));
    }
    if (filters.slaBreachedOnly) {
      predicates.push(
        and(
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`
        )!
      );
    }
    if (filters.staleOnly) {
      // "No activity in the last 14 days" = no recent activity row exists.
      // NOT EXISTS hits the (request_id, created_at) compound index added
      // in migration 0005 — index-only scan, short-circuits on the first
      // matching row instead of computing MAX over the heap. Replaces a
      // pair of correlated subqueries that ORed "max(created_at) < N days
      // ago" with "count(*) = 0".
      predicates.push(
        sql`NOT EXISTS (
          SELECT 1 FROM request_activities ra
          WHERE ra.request_id = ${schema.requests.id}
            AND ra.created_at >= now() - interval '14 days'
        )`
      );
    }

    const whereClause = and(...predicates);

    const [items, [{ count }]] = await Promise.all([
      tx
        .select({
          id: schema.requests.id,
          contactName: schema.requests.contactName,
          contactEmail: schema.requests.contactEmail,
          contactPhone: schema.requests.contactPhone,
          treatmentWish: schema.requests.treatmentWish,
          treatmentId: schema.requests.treatmentId,
          treatmentName: schema.treatments.name,
          source: schema.requests.source,
          status: schema.requests.status,
          aiScore: schema.requests.aiScore,
          aiCategory: schema.requests.aiCategory,
          slaRespondBy: schema.requests.slaRespondBy,
          firstContactedAt: schema.requests.firstContactedAt,
          createdAt: schema.requests.createdAt,
          assignedTo: schema.requests.assignedTo,
        })
        .from(schema.requests)
        .leftJoin(
          schema.treatments,
          eq(schema.requests.treatmentId, schema.treatments.id)
        )
        .where(whereClause)
        .orderBy(desc(schema.requests.createdAt))
        .limit(limit)
        .offset(offset),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.requests)
        .where(whereClause),
    ]);

    return {
      items: items.map((i) => ({ ...i, status: i.status as RequestStatus })),
      total: Number(count ?? 0),
    };
  });
}

/**
 * Count of unread new leads — drives the sidebar Anfragen badge.
 *
 * "Unread" = status still 'neu' AND no clinic user has opened the detail
 * page yet (`firstViewedAt IS NULL`). The badge drops the moment someone
 * actually interacts with the lead, not just when they land on the inbox.
 * Backed by the partial index `requests_unread_idx`.
 */
export async function countNewRequests(
  clinicId: string,
  userId: string
): Promise<number> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [row] = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(schema.requests)
        .where(
          and(
            eq(schema.requests.clinicId, clinicId),
            eq(schema.requests.status, "neu"),
            isNull(schema.requests.firstViewedAt)
          )
        );
      return Number(row?.c ?? 0);
    },
    "requests:count-new"
  );
}

/**
 * Records the first time any clinic user opens this request's detail
 * page. Idempotent: only writes when `firstViewedAt` is still NULL, so
 * the value sticks to the actual first view. Best-effort — failures are
 * swallowed so a transient write error never breaks the detail page.
 */
export async function markRequestViewed(
  clinicId: string,
  userId: string,
  requestId: string
): Promise<void> {
  try {
    await withClinicContext(
      clinicId,
      userId,
      (tx) =>
        tx
          .update(schema.requests)
          .set({ firstViewedAt: new Date() })
          .where(
            and(
              eq(schema.requests.id, requestId),
              eq(schema.requests.clinicId, clinicId),
              isNull(schema.requests.firstViewedAt)
            )
          ),
      "requests:mark-viewed"
    );
    // Sidebar Anfragen badge counts unviewed leads — flush so the pill
    // updates on the next render instead of waiting for the 30 s TTL.
    invalidateNavBadges(clinicId, userId);
  } catch {
    // Non-critical — silently drop.
  }
}

/** Inbound request count series for the last N days — Detail-mode sparkline. */
export async function inboundCountSeries(
  clinicId: string,
  userId: string,
  days = 30
): Promise<number[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const rows = await tx
      .select({
        date: sql<string>`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, since)
        )
      )
      .groupBy(sql`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
    const map = new Map<string, number>(
      rows.map((r) => [r.date, Number(r.count)])
    );
    const out: number[] = [];
    const cursor = new Date(since);
    while (cursor.getTime() <= Date.now()) {
      out.push(map.get(cursor.toISOString().slice(0, 10)) ?? 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  });
}

export async function getRequestWithActivities(
  clinicId: string,
  userId: string,
  requestId: string
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [request] = await tx
      .select()
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, requestId),
          eq(schema.requests.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!request) return null;

    const [activities, treatmentRow, locationRow] = await Promise.all([
      tx
        .select({
          id: schema.requestActivities.id,
          requestId: schema.requestActivities.requestId,
          actorId: schema.requestActivities.actorId,
          actorName: schema.clinicUsers.fullName,
          actorEmail: schema.clinicUsers.email,
          actorAvatarKey: schema.clinicUsers.avatarKey,
          actorAvatarUpdatedAt: schema.clinicUsers.avatarUpdatedAt,
          kind: schema.requestActivities.kind,
          body: schema.requestActivities.body,
          meta: schema.requestActivities.meta,
          createdAt: schema.requestActivities.createdAt,
        })
        .from(schema.requestActivities)
        .leftJoin(
          schema.clinicUsers,
          eq(schema.requestActivities.actorId, schema.clinicUsers.id)
        )
        .where(eq(schema.requestActivities.requestId, requestId))
        .orderBy(desc(schema.requestActivities.createdAt)),
      request.treatmentId
        ? tx
            .select({ name: schema.treatments.name })
            .from(schema.treatments)
            .where(eq(schema.treatments.id, request.treatmentId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
      request.locationId
        ? tx
            .select({ name: schema.locations.name })
            .from(schema.locations)
            .where(eq(schema.locations.id, request.locationId))
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

    return {
      request,
      activities: activities.map((a) => ({
        ...a,
        actorAvatarUrl: avatarUrlForKey(a.actorAvatarKey, a.actorAvatarUpdatedAt),
      })),
      treatmentName: treatmentRow?.name ?? null,
      locationName: locationRow?.name ?? null,
    };
  });
}

/** Count of requests bucketed by status — used on the dashboard's inbox hint. */
export async function requestStatusCounts(clinicId: string, userId: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        status: schema.requests.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(eq(schema.requests.clinicId, clinicId))
      .groupBy(schema.requests.status);
    const map: Record<string, number> = {};
    for (const r of rows) map[r.status] = Number(r.count);
    return map;
  });
}

/** Requests where SLA is breached (not yet responded AND sla_respond_by < now()). */
export async function slaBreachedCount(clinicId: string, userId: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`,
          inArray(schema.requests.status, ["neu", "qualifiziert"])
        )
      );
    return Number(rows[0]?.count ?? 0);
  });
}

/** Requests created in the last N days — for "Neue Anfragen heute". */
export async function recentRequestsCount(
  clinicId: string,
  userId: string,
  days = 1
) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, since)
        )
      );
    return Number(rows[0]?.count ?? 0);
  });
}

/**
 * Total requests in an arbitrary [from, to] window with prior-period
 * comparison, plus the qualified subset for the current window. "Total"
 * means every request that landed in the inbox — regardless of `status`
 * — so it includes spam, duplicates, archived, etc. "Qualified" matches
 * the kpi-rebuild worker's definition (`status <> 'spam'`), so the rate
 * is consistent with the leads-card numbers, but computed in the same
 * query as `total` against the same source table — guaranteeing
 * qualified ≤ total even when the kpi_daily denormalization is stale or
 * shifted by a timezone boundary.
 *
 * Used by the dashboard's "Anfragen gesamt" top-metric card. The prior
 * window is the same number of days immediately before `from`, so the
 * delta matches the comparison conventions used by `kpiSummaryWithComparison`.
 */
export async function totalRequestsInRangeWithComparison(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{
  current: number;
  qualified: number;
  prior: number;
  deltaPct: number | null;
}> {
  const windowMs = to.getTime() - from.getTime();
  const priorFrom = new Date(from.getTime() - windowMs - 1);
  const priorTo = new Date(from.getTime() - 1);
  return withClinicContext(clinicId, userId, async (tx) => {
    const currentRowsP = tx
      .select({
        total: sql<number>`count(*)::int`,
        qualified: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      );

    const priorRowsP = tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, priorFrom),
          lte(schema.requests.createdAt, priorTo)
        )
      );

    const [currentRows, priorRows] = await Promise.all([currentRowsP, priorRowsP]);
    const current = Number(currentRows[0]?.total ?? 0);
    const qualified = Number(currentRows[0]?.qualified ?? 0);
    const prior = Number(priorRows[0]?.count ?? 0);
    const deltaPct =
      prior > 0
        ? Number(((current - prior) / prior).toFixed(4))
        : current > 0
        ? null
        : 0;
    return { current, qualified, prior, deltaPct };
  });
}

/**
 * Daily count of incoming requests across a [from, to] window. Returns
 * dense series (zero-filled for missing days) so the chart can render
 * without gap interpolation.
 */
export async function totalRequestsDailyInRange(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{ dates: string[]; counts: number[] }> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: sql<string>`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(sql`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
    const map = new Map<string, number>(
      rows.map((r) => [r.date, Number(r.count)])
    );
    const dates: string[] = [];
    const counts: number[] = [];
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      dates.push(iso);
      counts.push(map.get(iso) ?? 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    return { dates, counts };
  });
}

/**
 * Qualified leads (status <> 'spam') and won cases in [from, to], with a
 * prior-period comparison on the qualified count. Computed directly from
 * the `requests` table — distinct from the equivalent fields on
 * `kpiSummaryUncached`, which sums the denormalized `kpi_daily` table and
 * can drift if the rebuild worker hasn't run for those dates. Used by the
 * dashboard's "Qualifizierte Anfragen" top-metric card so that its number
 * stays mathematically consistent with the "Anfragen gesamt" card
 * (qualified ≤ total, both sourced from the same query path).
 *
 * "Qualified" matches the kpi-rebuild definition (everything that isn't
 * spam) so the headline number means the same thing it always did — we
 * just compute it live instead of reading the snapshot.
 */
export async function qualifiedLeadsInRangeWithComparison(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{
  qualified: number;
  won: number;
  qualifiedPrior: number;
  qualifiedDeltaPct: number | null;
}> {
  const windowMs = to.getTime() - from.getTime();
  const priorFrom = new Date(from.getTime() - windowMs - 1);
  const priorTo = new Date(from.getTime() - 1);
  return withClinicContext(clinicId, userId, async (tx) => {
    const currentRowsP = tx
      .select({
        qualified: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
        won: sql<number>`count(*) filter (where ${schema.requests.status} = 'gewonnen')::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      );

    const priorRowsP = tx
      .select({
        qualified: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, priorFrom),
          lte(schema.requests.createdAt, priorTo)
        )
      );

    const [currentRows, priorRows] = await Promise.all([currentRowsP, priorRowsP]);
    const qualified = Number(currentRows[0]?.qualified ?? 0);
    const won = Number(currentRows[0]?.won ?? 0);
    const qualifiedPrior = Number(priorRows[0]?.qualified ?? 0);
    const qualifiedDeltaPct =
      qualifiedPrior > 0
        ? Number(((qualified - qualifiedPrior) / qualifiedPrior).toFixed(4))
        : qualified > 0
        ? null
        : 0;
    return { qualified, won, qualifiedPrior, qualifiedDeltaPct };
  });
}

/**
 * Daily count of qualified leads (status <> 'spam') across [from, to].
 * Dense series, zero-filled. Live equivalent of the per-day qualifiedLeads
 * column on `kpi_daily` — sparkline-friendly for the leads top-metric card.
 */
export async function qualifiedLeadsDailyInRange(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{ dates: string[]; counts: number[] }> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        date: sql<string>`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        count: sql<number>`count(*) filter (where ${schema.requests.status} <> 'spam')::int`,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          gte(schema.requests.createdAt, from),
          lte(schema.requests.createdAt, to)
        )
      )
      .groupBy(sql`to_char(${schema.requests.createdAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
    const map = new Map<string, number>(
      rows.map((r) => [r.date, Number(r.count)])
    );
    const dates: string[] = [];
    const counts: number[] = [];
    const cursor = new Date(from);
    cursor.setUTCHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= end.getTime()) {
      const iso = cursor.toISOString().slice(0, 10);
      dates.push(iso);
      counts.push(map.get(iso) ?? 0);
      cursor.setDate(cursor.getDate() + 1);
    }
    return { dates, counts };
  });
}

/**
 * Open queue size at end-of-day for each day in [from, to], plus a delta
 * comparing the queue at the end of the window vs. just before the window
 * started ("did the open queue grow or shrink across this period?").
 *
 * "Open" = status IN ('neu','qualifiziert') — matches the dashboard's
 * `openRequests = statusCounts.neu + statusCounts.qualifiziert` headline.
 *
 * Historical reconstruction walks *backwards* from each request's current
 * status: status_at(R, T) = (earliest status_change AFTER T).meta.from,
 * falling back to R.status when no later change exists. This is robust to
 * seed rows that were inserted directly in a terminal status without a
 * corresponding `status_change` activity, while still being exact for
 * production data where every transition is logged as a `status_change`
 * activity by the upstream PVS sync.
 *
 * Used by the dashboard's "Offene Anfragen" top-metric card to give the
 * range toggle, delta, and sparkline a coherent metric — replaces an
 * earlier wiring where the chart/delta showed *qualified leads* under the
 * "open queue" headline.
 */
export async function openQueueDailyInRangeWithComparison(
  clinicId: string,
  userId: string,
  from: Date,
  to: Date
): Promise<{
  dates: string[];
  counts: number[];
  current: number;
  prior: number;
  deltaPct: number | null;
}> {
  // `from` is start-of-day, `to` is end-of-day (per `dashboardRangeWindow`).
  // Prior anchor: the instant just before this window began.
  const priorAt = new Date(from.getTime() - 1);
  return withClinicContext(clinicId, userId, async (tx) => {
    const dailyRows = await tx.execute(sql`
      WITH days AS (
        SELECT generate_series(
          (${from.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date,
          (${to.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date,
          interval '1 day'
        )::date AS d
      )
      SELECT
        to_char(d.d, 'YYYY-MM-DD') AS date,
        COUNT(*) FILTER (
          WHERE r.created_at <= (d.d + interval '1 day' - interval '1 microsecond')
            AND COALESCE(
              (
                SELECT ra.meta->>'from'
                FROM request_activities ra
                WHERE ra.request_id = r.id
                  AND ra.kind = 'status_change'
                  AND ra.created_at > (d.d + interval '1 day' - interval '1 microsecond')
                ORDER BY ra.created_at ASC
                LIMIT 1
              ),
              r.status
            ) IN ('neu', 'qualifiziert')
        )::int AS open_count
      FROM days d
      CROSS JOIN requests r
      WHERE r.clinic_id = ${clinicId}
      GROUP BY d.d
      ORDER BY d.d
    `);

    const priorRows = await tx.execute(sql`
      SELECT COUNT(*)::int AS open_count
      FROM requests r
      WHERE r.clinic_id = ${clinicId}
        AND r.created_at <= ${priorAt.toISOString()}::timestamptz
        AND COALESCE(
          (
            SELECT ra.meta->>'from'
            FROM request_activities ra
            WHERE ra.request_id = r.id
              AND ra.kind = 'status_change'
              AND ra.created_at > ${priorAt.toISOString()}::timestamptz
            ORDER BY ra.created_at ASC
            LIMIT 1
          ),
          r.status
        ) IN ('neu', 'qualifiziert')
    `);

    const rows = dailyRows as unknown as Array<{ date: string; open_count: number }>;
    const dates = rows.map((r) => r.date);
    const counts = rows.map((r) => Number(r.open_count));
    const current = counts.length > 0 ? counts[counts.length - 1]! : 0;
    const priorResult = priorRows as unknown as Array<{ open_count: number }>;
    const prior = Number(priorResult[0]?.open_count ?? 0);
    const deltaPct =
      prior > 0
        ? Number(((current - prior) / prior).toFixed(4))
        : current > 0
        ? null
        : 0;
    return { dates, counts, current, prior, deltaPct };
  });
}
