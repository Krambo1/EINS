import "server-only";
import { and, desc, eq, gte, ilike, inArray, or, sql, isNull } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { RequestStatus } from "@/lib/constants";

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
      predicates.push(
        sql`(SELECT max(created_at) FROM request_activities WHERE request_id = ${schema.requests.id}) < now() - interval '14 days' OR (SELECT count(*) FROM request_activities WHERE request_id = ${schema.requests.id}) = 0`
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
      activities,
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
