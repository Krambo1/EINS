import "server-only";
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";
import type { AnyRequestStatus, RequestStatus, RequestSort } from "@/lib/constants";
import { responseDeadline } from "@/lib/werkstunden";
import { avatarUrlForKey } from "@/server/avatars";
import { invalidateNavBadges } from "./navBadgesCache";
import { cacheClinicQuery, SHORT_REVALIDATE_S } from "./_cache";
import { firstAttemptAtSql, toAttemptDate } from "./response-time";
import { openCountsAtPoints, openQueuePoints } from "./requests-open-queue";

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
  /** First contact attempt per the 48-Werkstunden rule (queries/response-time.ts). */
  firstAttemptAt: Date | null;
  createdAt: Date;
  assignedTo: string | null;
  /** Lifetime-Wert des verknüpften Patienten; null wenn keiner verknüpft ist. */
  patientLtv: number | null;
}

/**
 * ORDER BY expressions per sort key. Every non-default sort appends
 * `createdAt DESC` as the final tiebreaker so rows that tie on the primary
 * key (the many LTV-0 or noch-nicht-bewerteten leads) still read newest-first.
 */
function requestSortOrderBy(sort: RequestSort): SQL[] {
  switch (sort) {
    case "aelteste":
      return [asc(schema.requests.createdAt)];
    case "ki":
      return [
        sql`${schema.requests.aiScore} desc nulls last`,
        desc(schema.requests.createdAt),
      ];
    case "ltv":
      return [
        sql`${schema.patients.lifetimeRevenueEur} desc nulls last`,
        desc(schema.requests.createdAt),
      ];
    case "dringlichkeit":
      // Überfällige, noch nicht bearbeitete Anfragen zuerst (Reaktion jetzt
      // nötig), dann nach Frist-Nähe (früheste SLA zuerst), dann neueste.
      return [
        sql`(${schema.requests.firstContactedAt} is null
              and ${schema.requests.slaRespondBy} is not null
              and ${schema.requests.slaRespondBy} < now()) desc`,
        sql`${schema.requests.slaRespondBy} asc nulls last`,
        desc(schema.requests.createdAt),
      ];
    case "neueste":
    default:
      return [desc(schema.requests.createdAt)];
  }
}

export interface RequestListFilters {
  status?: AnyRequestStatus[];
  source?: string[];
  aiCategory?: ("hot" | "warm" | "cold")[];
  treatmentId?: string[];
  search?: string;
  assignedTo?: string | "unassigned" | null;
  slaBreachedOnly?: boolean;
  /** When true, only return rows with no activity in the last 14 days. */
  staleOnly?: boolean;
}

/** Escape LIKE/ILIKE wildcards so a typed `%` or `_` matches literally (C-23). */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * Digits of a typed phone number, reduced to the national number without
 * leading zeros or country code, so "0170 123", "+49 170 123" and
 * "0049170123" all search for "170123". Null when the term does not look like
 * a phone number (letters, or fewer than 4 digits).
 */
export function phoneSearchDigits(term: string): string | null {
  if (!/^[\d\s+()\/.-]+$/.test(term)) return null;
  const hadIntlPrefix = /^\s*(\+|00)/.test(term);
  let digits = term.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (hadIntlPrefix && /^(49|43|41)/.test(digits)) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  return digits.length >= 4 ? digits : null;
}

function requestListWhere(clinicId: string, filters: RequestListFilters): SQL {
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
      const term = `%${escapeLike(filters.search)}%`;
      const phoneDigits = phoneSearchDigits(filters.search);
      predicates.push(
        or(
          ilike(schema.requests.contactName, term),
          ilike(schema.requests.contactEmail, term),
          ilike(schema.requests.contactPhone, term),
          ilike(schema.requests.treatmentWish, term),
          ...(phoneDigits
            ? [
                sql`regexp_replace(coalesce(${schema.requests.contactPhone}, ''), '\\D', '', 'g') LIKE ${`%${phoneDigits}%`}`,
              ]
            : [])
        )!
      );
    }
    if (filters.assignedTo === "unassigned") {
      predicates.push(isNull(schema.requests.assignedTo));
    } else if (filters.assignedTo) {
      predicates.push(eq(schema.requests.assignedTo, filters.assignedTo));
    }
    if (filters.slaBreachedOnly) {
      // Same predicate as slaBreachedCount (V2 Neben 2): only open "neu"
      // Anfragen, so the list matches the number on the dashboard.
      predicates.push(
        and(
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`,
          eq(schema.requests.status, "neu")
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

    return and(...predicates)!;
}

/**
 * Paginated list for the inbox. Sort orders (see `requestSortOrderBy`):
 *   - `neueste` (default): newest first
 *   - `aelteste`: oldest first (FIFO, nichts fällt hinten runter)
 *   - `ki`: highest KI-Score first (hottest leads), unscored last
 *   - `ltv`: highest Patienten-Lifetime-Wert first, unlinked/0 last
 *   - `dringlichkeit`: overdue-uncontacted first, then earliest SLA deadline
 */
export async function listRequests(
  clinicId: string,
  userId: string,
  filters: RequestListFilters = {},
  opts: { limit?: number; offset?: number; sort?: RequestSort } = {}
): Promise<{ items: RequestListItem[]; total: number }> {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const sort = opts.sort ?? "neueste";

  return withClinicContext(clinicId, userId, async (tx) => {
    const whereClause = requestListWhere(clinicId, filters);

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
          firstAttemptAt: firstAttemptAtSql(),
          createdAt: schema.requests.createdAt,
          assignedTo: schema.requests.assignedTo,
          patientLtv: schema.patients.lifetimeRevenueEur,
        })
        .from(schema.requests)
        .leftJoin(
          schema.treatments,
          eq(schema.requests.treatmentId, schema.treatments.id)
        )
        .leftJoin(
          schema.patients,
          eq(schema.requests.patientId, schema.patients.id)
        )
        .where(whereClause)
        .orderBy(...requestSortOrderBy(sort))
        .limit(limit)
        .offset(offset),
      tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.requests)
        .where(whereClause),
    ]);

    return {
      items: items.map((i) => ({
        ...i,
        status: i.status as RequestStatus,
        firstAttemptAt: toAttemptDate(i.firstAttemptAt),
        patientLtv: i.patientLtv != null ? Number(i.patientLtv) : null,
      })),
      total: Number(count ?? 0),
    };
  });
}

export interface RequestSearchHit {
  id: string;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  treatmentWish: string | null;
}

/**
 * Typeahead for the command palette (D-20): same search predicate as the
 * inbox, but no count, no joins and no per-row attempt subquery.
 */
export async function searchRequestsLite(
  clinicId: string,
  userId: string,
  search: string,
  limit = 6
): Promise<RequestSearchHit[]> {
  return withClinicContext(
    clinicId,
    userId,
    (tx) =>
      tx
        .select({
          id: schema.requests.id,
          contactName: schema.requests.contactName,
          contactEmail: schema.requests.contactEmail,
          contactPhone: schema.requests.contactPhone,
          treatmentWish: schema.requests.treatmentWish,
        })
        .from(schema.requests)
        .where(requestListWhere(clinicId, { search }))
        .orderBy(desc(schema.requests.createdAt))
        .limit(limit),
    "requests:search-lite"
  );
}

export interface RequestExportRow {
  id: string;
  createdAt: Date;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  treatmentName: string | null;
  treatmentWish: string | null;
  source: string;
  status: string;
  aiCategory: string | null;
  firstContactedAt: Date | null;
  message: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
}

/** Upper bound for one CSV export, keeps the function inside its time limit. */
export const REQUEST_EXPORT_MAX_ROWS = 10_000;

/**
 * Every Anfrage matching the inbox filters, for the CSV export (H-09).
 * Same WHERE and ORDER BY as the list, capped at REQUEST_EXPORT_MAX_ROWS.
 */
export async function exportRequests(
  clinicId: string,
  userId: string,
  filters: RequestListFilters,
  sort: RequestSort = "neueste"
): Promise<{ rows: RequestExportRow[]; truncated: boolean }> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const rows = await tx
        .select({
          id: schema.requests.id,
          createdAt: schema.requests.createdAt,
          contactName: schema.requests.contactName,
          contactEmail: schema.requests.contactEmail,
          contactPhone: schema.requests.contactPhone,
          treatmentName: schema.treatments.name,
          treatmentWish: schema.requests.treatmentWish,
          source: schema.requests.source,
          status: schema.requests.status,
          aiCategory: schema.requests.aiCategory,
          firstContactedAt: schema.requests.firstContactedAt,
          message: schema.requests.message,
          utmCampaign: sql<string | null>`${schema.requests.utm}->>'utm_campaign'`,
          utmContent: sql<string | null>`${schema.requests.utm}->>'utm_content'`,
        })
        .from(schema.requests)
        .leftJoin(
          schema.treatments,
          eq(schema.requests.treatmentId, schema.treatments.id)
        )
        .leftJoin(
          schema.patients,
          eq(schema.requests.patientId, schema.patients.id)
        )
        .where(requestListWhere(clinicId, filters))
        .orderBy(...requestSortOrderBy(sort))
        .limit(REQUEST_EXPORT_MAX_ROWS + 1);
      return {
        rows: rows.slice(0, REQUEST_EXPORT_MAX_ROWS),
        truncated: rows.length > REQUEST_EXPORT_MAX_ROWS,
      };
    },
    "requests:export"
  );
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

/** The nested quiz answers inside `ai_signals`, if any (jsonb is `unknown`). */
export function quizFromSignals(signals: unknown): Record<string, unknown> | null {
  if (!signals || typeof signals !== "object") return null;
  const quiz = (signals as Record<string, unknown>).quiz;
  return !!quiz && typeof quiz === "object" && !Array.isArray(quiz)
    ? (quiz as Record<string, unknown>)
    : null;
}

export interface CallQueueLead {
  id: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  treatmentWish: string | null;
  treatmentName: string | null;
  source: string;
  status: RequestStatus;
  aiScore: number | null;
  aiCategory: string | null;
  message: string | null;
  /** Patient answers from the Zielseiten-Quiz (`ai_signals.quiz`), C-26. */
  quiz: Record<string, unknown> | null;
  slaRespondBy: Date | null;
  firstContactedAt: Date | null;
  /** First contact attempt per the 48-Werkstunden rule (queries/response-time.ts). */
  firstAttemptAt: Date | null;
  createdAt: Date;
  /** Earliest still-pending Wiedervorlage for this lead, NULL if none. */
  nextFollowupAt: Date | null;
  /** Linked to a PVS appointment → the PVS owns the lifecycle, manual status
   *  writes are refused. The card hides the status-flip when this is true. */
  pvsControlled: boolean;
}

/**
 * Prioritised lead-queue for the "Jetzt anrufen" view (every role that
 * works Anfragen, see anfragen/page.tsx).
 *
 * Surfaces leads still in the manual working phase: status ∈ {neu,
 * kontaktiert, nicht_erreicht, termin_vereinbart}. `kontaktiert` /
 * `nicht_erreicht` keep worked-but-unbooked leads visible so they don't
 * vanish the moment the MFA logs a first call. Sort order is the order the
 * MFA/Sekretariat should actually pick up the phone in (C-17: the
 * 48-Werkstunden deadline leads, the KI category only breaks ties, so a cold
 * Anfrage cannot be pushed back by newer hot ones until its deadline is lost):
 *   1. Fällige Wiedervorlage (pending, due_at <= now): selbst gesetzter
 *      Rückruf-Termin, der jetzt ansteht
 *   2. Noch kein Kontaktversuch und die 48-Werkstunden-Frist läuft noch:
 *      älteste zuerst = nächste Frist zuerst (die Frist wächst monoton mit
 *      dem Eingang)
 *   3. Noch kein Kontaktversuch, Frist schon verstrichen
 *   4. Bereits angefasst (kontaktiert, nicht erreicht, Termin)
 *   Innerhalb 3 und 4: KI-Kategorie hot → warm → kalt/unbekannt, dann
 *   älteste zuerst.
 *
 * The earliest pending Wiedervorlage is pulled per lead via a correlated
 * subquery so the "fällig zuerst" ordering happens BEFORE the LIMIT — a lead
 * whose callback just came due rises into the visible queue even if its age
 * would otherwise bury it.
 *
 * Returns the columns the queue cards need INCLUDING `message` so the MFA
 * sees the patient's own words on the card before clicking — listRequests
 * skips this on purpose because the inbox row doesn't need it.
 */
export async function nextCallQueueLeads(
  clinicId: string,
  userId: string,
  limit = 6
): Promise<CallQueueLead[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const nextFollowupAt = sql<Date | null>`(
      SELECT min(rf.due_at)
      FROM request_followups rf
      WHERE rf.request_id = ${schema.requests.id}
        AND rf.status = 'pending'
    )`;

    // M-2: both correlated subqueries are computed ONCE per open Anfrage in
    // this inner select; the ORDER BY below reads the columns. Inlined in
    // the ORDER BY, Postgres evaluated the first-attempt subquery four times
    // and the follow-up one three times per row (8 SubPlans, now 2). Same
    // rows, same order.
    const q = tx
      .select({
        id: schema.requests.id,
        contactName: schema.requests.contactName,
        contactPhone: schema.requests.contactPhone,
        contactEmail: schema.requests.contactEmail,
        treatmentWish: schema.requests.treatmentWish,
        treatmentName: schema.treatments.name,
        source: schema.requests.source,
        status: schema.requests.status,
        aiScore: schema.requests.aiScore,
        aiCategory: schema.requests.aiCategory,
        aiSignals: schema.requests.aiSignals,
        message: schema.requests.message,
        slaRespondBy: schema.requests.slaRespondBy,
        firstContactedAt: schema.requests.firstContactedAt,
        firstAttemptAt: firstAttemptAtSql().as("first_attempt_at"),
        createdAt: schema.requests.createdAt,
        pvsAppointmentId: schema.requests.pvsAppointmentId,
        nextFollowupAt: nextFollowupAt.as("next_followup_at"),
      })
      .from(schema.requests)
      .leftJoin(
        schema.treatments,
        eq(schema.requests.treatmentId, schema.treatments.id)
      )
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          inArray(schema.requests.status, [
            "neu",
            "kontaktiert",
            "nicht_erreicht",
            "termin_vereinbart",
          ])
        )
      )
      // OFFSET 0 keeps Postgres from pulling the subquery up and pasting the
      // subqueries back into every ORDER BY term (measured: 95 -> 24 ms at
      // 3,865 open Anfragen). Drizzle drops a numeric 0, hence the sql chunk.
      .offset(sql`0` as unknown as number)
      .as("call_queue");

    const runningSince = responseDeadlineRunningSince(new Date());
    const noAttempt = sql`${q.firstAttemptAt} IS NULL`;
    const deadlineRunning = sql`(${noAttempt} AND ${q.createdAt} >= ${runningSince.toISOString()}::timestamptz)`;

    const rows = await tx
      .select()
      .from(q)
      .orderBy(
        sql`(${q.nextFollowupAt} IS NOT NULL AND ${q.nextFollowupAt} <= now()) DESC`,
        sql`${deadlineRunning} DESC`,
        sql`${noAttempt} DESC`,
        sql`CASE WHEN ${deadlineRunning} THEN ${q.createdAt} END ASC NULLS LAST`,
        sql`CASE ${q.aiCategory}
              WHEN 'hot' THEN 0
              WHEN 'warm' THEN 1
              WHEN 'cold' THEN 2
              ELSE 3
            END`,
        q.createdAt
      )
      .limit(limit);

    return rows.map(({ pvsAppointmentId, aiSignals, ...r }) => ({
      ...r,
      quiz: quizFromSignals(aiSignals),
      status: r.status as RequestStatus,
      firstAttemptAt: toAttemptDate(r.firstAttemptAt),
      nextFollowupAt: r.nextFollowupAt ? new Date(r.nextFollowupAt) : null,
      pvsControlled: pvsAppointmentId != null,
    }));
  });
}

/**
 * Earliest `createdAt` whose 48-Werkstunden deadline is still in the future
 * at `now`. The deadline grows monotonically with the arrival time, so a
 * binary search over the last 30 days finds the cut (to ~1 s).
 */
export function responseDeadlineRunningSince(now: Date): Date {
  let lo = now.getTime() - 30 * 86_400_000; // deadline long gone
  let hi = now.getTime(); // just arrived, deadline ahead
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2);
    if (responseDeadline(new Date(mid)).getTime() > now.getTime()) hi = mid;
    else lo = mid;
  }
  return new Date(hi);
}

export interface OpenLeadForDashboard {
  id: string;
  contactName: string | null;
  treatmentLabel: string | null;
  createdAt: Date;
  slaBreached: boolean;
}

/**
 * Top-N open Anfragen for the dashboard's "Offene Anfragen" tile footer.
 *
 * Mirrors the headline number on the tile (status='neu' only) and surfaces
 * the rows the MFA should act on next. Priority:
 *   1. SLA-überfällig & noch nicht kontaktiert
 *   2. Oldest first (FIFO — nothing falls off the back)
 *
 * Returns just the bits the dashboard footer renders — no message body, no
 * AI score, no full contact details. Anything richer is one click away on
 * /anfragen/{id}.
 */
async function openLeadsForDashboardUncached(
  clinicId: string,
  userId: string,
  limit = 5,
): Promise<OpenLeadForDashboard[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.requests.id,
        contactName: schema.requests.contactName,
        treatmentWish: schema.requests.treatmentWish,
        treatmentName: schema.treatments.name,
        slaRespondBy: schema.requests.slaRespondBy,
        firstContactedAt: schema.requests.firstContactedAt,
        createdAt: schema.requests.createdAt,
      })
      .from(schema.requests)
      .leftJoin(
        schema.treatments,
        eq(schema.requests.treatmentId, schema.treatments.id),
      )
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          eq(schema.requests.status, "neu"),
        ),
      )
      .orderBy(
        sql`(${schema.requests.firstContactedAt} IS NULL
              AND ${schema.requests.slaRespondBy} IS NOT NULL
              AND ${schema.requests.slaRespondBy} < now()) DESC`,
        schema.requests.createdAt,
      )
      .limit(limit);

    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      contactName: r.contactName,
      treatmentLabel: r.treatmentName ?? r.treatmentWish ?? null,
      createdAt: r.createdAt,
      slaBreached:
        r.firstContactedAt == null &&
        r.slaRespondBy != null &&
        r.slaRespondBy.getTime() < now,
    }));
  });
}

/**
 * Cached for SHORT_REVALIDATE_S. Range-independent (the Offene-Anfragen list is
 * always "current open queue, top N"), so re-running it on every unrelated
 * TimeRangeToggle is waste. `createdAt` round-trips through unstable_cache as an
 * ISO string, which `formatRelative` (the only consumer) accepts; `slaBreached`
 * is precomputed in the body so it caches as a plain boolean.
 */
export const openLeadsForDashboard = cacheClinicQuery(
  "openLeadsForDashboard",
  openLeadsForDashboardUncached,
  { revalidate: SHORT_REVALIDATE_S }
);

/** Newest Verlauf entries loaded on the detail page (D-6). */
export const REQUEST_ACTIVITY_LIMIT = 200;

export async function getRequestWithActivities(
  clinicId: string,
  userId: string,
  requestId: string
) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select({
        ...getTableColumns(schema.requests),
        firstAttemptAt: firstAttemptAtSql(),
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.id, requestId),
          eq(schema.requests.clinicId, clinicId)
        )
      )
      .limit(1);

    if (!row) return null;
    const { firstAttemptAt, ...request } = row;

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
        .orderBy(desc(schema.requestActivities.createdAt))
        .limit(REQUEST_ACTIVITY_LIMIT),
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
      /** First contact attempt per the 48-Werkstunden rule. */
      firstAttemptAt: toAttemptDate(firstAttemptAt),
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
async function requestStatusCountsUncached(clinicId: string, userId: string) {
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

/**
 * Cached for SHORT_REVALIDATE_S. Range-independent, so the dashboard re-running
 * it on every TimeRangeToggle is pure waste. Read only by the dashboard's
 * Offene-Anfragen tile; /anfragen reads live counts elsewhere, so a ~30s lag on
 * the dashboard headline (where you don't action requests) is acceptable.
 */
export const requestStatusCounts = cacheClinicQuery(
  "requestStatusCounts",
  requestStatusCountsUncached,
  { revalidate: SHORT_REVALIDATE_S }
);

/**
 * Count of requests bucketed by KI category (hot/warm/cold) — drives the
 * count pills on the Anfragen "KI-Bewertung" filter. Clinic-wide totals,
 * independent of the other active filters, so the number answers "how many
 * are actually marked Kalt" rather than shifting as you click around.
 * Rows with no aiCategory yet are dropped (no bucket to land in).
 */
async function aiCategoryCountsUncached(clinicId: string, userId: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        category: schema.requests.aiCategory,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.requests)
      .where(eq(schema.requests.clinicId, clinicId))
      .groupBy(schema.requests.aiCategory);
    const map: Record<string, number> = {};
    for (const r of rows) if (r.category) map[r.category] = Number(r.count);
    return map;
  });
}

/**
 * Cached for SHORT_REVALIDATE_S (D-19): independent of the list filters, so
 * typing in the search box no longer re-counts every Anfrage of the Praxis.
 */
export const aiCategoryCounts = cacheClinicQuery(
  "aiCategoryCounts",
  aiCategoryCountsUncached,
  { revalidate: SHORT_REVALIDATE_S }
);

/** Requests where SLA is breached (not yet responded AND sla_respond_by < now()). */
async function slaBreachedCountUncached(clinicId: string, userId: string) {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          isNull(schema.requests.firstContactedAt),
          sql`${schema.requests.slaRespondBy} < now()`,
          eq(schema.requests.status, "neu")
        )
      );
    return Number(rows[0]?.count ?? 0);
  });
}

/**
 * Cached for SHORT_REVALIDATE_S. Range-independent — same reasoning as
 * requestStatusCounts. The `< now()` breach cutoff being up to ~30s stale on
 * the dashboard tile is immaterial against the 2h SLA window.
 */
export const slaBreachedCount = cacheClinicQuery(
  "slaBreachedCount",
  slaBreachedCountUncached,
  { revalidate: SHORT_REVALIDATE_S }
);

/**
 * Open queue size at end-of-day for each day in [from, to], plus a delta
 * comparing the queue at the end of the window vs. just before the window
 * started ("did the open queue grow or shrink across this period?").
 *
 * "Open" = status = 'neu' — matches the dashboard's
 * `openRequests = statusCounts.neu` headline.
 *
 * Historical reconstruction walks *backwards* from each request's current
 * status: status_at(R, T) = status before the earliest status_change AFTER
 * T, falling back to R.status when no later change exists. "Status before"
 * = meta.from, else the new status (meta.to ?? meta.derivedStatus) of the
 * previous change, else 'neu'; rows without any of those keys are ignored
 * (rule in requests-open-queue.ts). This is robust to seed rows inserted
 * directly in a terminal status without a `status_change` activity, and to
 * older PVS rows that only carry meta.derivedStatus.
 *
 * Used by the dashboard's "Offene Anfragen" top-metric card to give the
 * range toggle, delta, and sparkline a coherent metric — replaces an
 * earlier wiring where the chart/delta showed *leads* under the
 * "open queue" headline.
 */
async function openQueueDailyInRangeWithComparisonUncached(
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
  // Points: the instant just before the window (prior anchor) and the end of
  // every Berlin day in the window. One pass over the Anfragen and their
  // status changes instead of a correlated subquery per (day x Anfrage).
  const { dates, priorAt, dayEnds } = openQueuePoints(from, to);
  const points = [priorAt, ...dayEnds];
  const lastPoint = new Date(Math.max(...points));
  return withClinicContext(clinicId, userId, async (tx) => {
    const [reqRows, changeRows] = await Promise.all([
      tx
        .select({
          id: schema.requests.id,
          createdAt: schema.requests.createdAt,
          status: schema.requests.status,
        })
        .from(schema.requests)
        .where(
          and(
            eq(schema.requests.clinicId, clinicId),
            lte(schema.requests.createdAt, lastPoint)
          )
        ),
      // Status changes after the prior anchor, each with the new status of
      // its predecessor (LAG over ALL changes of the Anfrage, so the first
      // change in the window still knows the status it left when its row
      // has no meta.from). Rows without from/to/derivedStatus are no status
      // change and are dropped before the LAG. One scan of this Praxis's
      // status changes, no per-day or per-Anfrage subquery.
      tx.execute(sql`
        SELECT s.request_id, s.created_ms, s.from_status, s.to_status, s.prev_to
        FROM (
          SELECT ra.id,
                 ra.request_id,
                 ra.created_at,
                 floor(extract(epoch FROM ra.created_at) * 1000)::float8 AS created_ms,
                 ra.meta->>'from' AS from_status,
                 COALESCE(ra.meta->>'to', ra.meta->>'derivedStatus') AS to_status,
                 LAG(COALESCE(ra.meta->>'to', ra.meta->>'derivedStatus')) OVER (
                   PARTITION BY ra.request_id ORDER BY ra.created_at, ra.id
                 ) AS prev_to
          FROM request_activities ra
          JOIN requests r ON r.id = ra.request_id
          WHERE r.clinic_id = ${clinicId}
            AND r.created_at <= ${lastPoint.toISOString()}::timestamptz
            AND ra.kind = 'status_change'
            AND (
              ra.meta->>'from' IS NOT NULL
              OR ra.meta->>'to' IS NOT NULL
              OR ra.meta->>'derivedStatus' IS NOT NULL
            )
        ) s
        WHERE s.created_at > ${new Date(priorAt).toISOString()}::timestamptz
        ORDER BY s.request_id, s.created_at, s.id
      `),
    ]);
    const changes = changeRows as unknown as Array<{
      request_id: string;
      created_ms: number | string;
      from_status: string | null;
      to_status: string | null;
      prev_to: string | null;
    }>;

    const openAt = openCountsAtPoints(
      points,
      reqRows.map((r) => ({ id: r.id, createdAt: r.createdAt.getTime(), status: r.status })),
      changes.map((c) => ({
        requestId: c.request_id,
        createdAt: Number(c.created_ms),
        from: c.from_status,
        to: c.to_status,
        prevTo: c.prev_to,
      }))
    );
    const prior = openAt[0] ?? 0;
    const counts = openAt.slice(1);
    const current = counts.length > 0 ? counts[counts.length - 1]! : 0;
    const deltaPct =
      prior > 0
        ? Number(((current - prior) / prior).toFixed(4))
        : current > 0
        ? null
        : 0;
    return { dates, counts, current, prior, deltaPct };
  });
}

/**
 * Cached for SHORT_REVALIDATE_S, keyed by (clinic, from, to). Backs the
 * dashboard's "Offene Anfragen" sparkline + delta (re-exported as
 * `openQueueDaily` from kpis.ts); caching it per window means an unrelated
 * TimeRangeToggle no longer pays for it. Returns only string dates +
 * numbers.
 */
export const openQueueDailyInRangeWithComparison = cacheClinicQuery(
  "openQueueDailyInRangeWithComparison",
  openQueueDailyInRangeWithComparisonUncached,
  { dateArgs: [0, 1], revalidate: SHORT_REVALIDATE_S }
);
