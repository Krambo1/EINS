import "server-only";
import { and, desc, eq, gte, isNotNull, lte, ne, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Patient + recall helpers — Detail-mode panels: Top LTV, LTV by channel,
 * upcoming recalls, sibling requests for a single patient.
 */

export interface TopPatientRow {
  patientId: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  lifetimeRevenueEur: number;
  requestCount: number;
  wonCount: number;
  lastSeenAt: Date;
  firstTouchSource: string | null;
}

export async function topPatientsByLtv(
  clinicId: string,
  userId: string,
  limit = 10
): Promise<TopPatientRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        patientId: schema.patients.id,
        fullName: schema.patients.fullName,
        email: schema.patients.email,
        phone: schema.patients.phone,
        lifetimeRevenueEur: schema.patients.lifetimeRevenueEur,
        requestCount: schema.patients.requestCount,
        wonCount: schema.patients.wonCount,
        lastSeenAt: schema.patients.lastSeenAt,
        firstTouchSource: schema.patients.firstTouchSource,
      })
      .from(schema.patients)
      .where(eq(schema.patients.clinicId, clinicId))
      .orderBy(desc(schema.patients.lifetimeRevenueEur))
      .limit(limit);

    return rows.map((r) => ({
      ...r,
      lifetimeRevenueEur: Number(r.lifetimeRevenueEur),
      requestCount: Number(r.requestCount),
      wonCount: Number(r.wonCount),
    }));
  });
}

export interface LtvByChannelRow {
  channel: string;
  patientCount: number;
  totalRevenueEur: number;
  avgLtvEur: number | null;
}

const CHANNEL_FOR_SOURCE: Record<string, string> = {
  meta: "meta",
  meta_lead_form: "meta",
  google: "google",
  google_form: "google",
  formular: "direkt",
  manuell: "direkt",
  whatsapp: "direkt",
  empfehlung: "empfehlung",
};

export async function ltvByChannel(
  clinicId: string,
  userId: string
): Promise<LtvByChannelRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        firstTouchSource: schema.patients.firstTouchSource,
        patientCount: sql<number>`count(*)::int`,
        totalRevenueEur: sql<number>`coalesce(sum(${schema.patients.lifetimeRevenueEur}), 0)`,
      })
      .from(schema.patients)
      .where(eq(schema.patients.clinicId, clinicId))
      .groupBy(schema.patients.firstTouchSource);

    const grouped = new Map<string, LtvByChannelRow>();
    for (const r of rows) {
      const channel =
        (r.firstTouchSource && CHANNEL_FOR_SOURCE[r.firstTouchSource]) ??
        r.firstTouchSource ??
        "unbekannt";
      const existing = grouped.get(channel);
      const patientCount = Number(r.patientCount);
      const totalRev = Number(r.totalRevenueEur);
      if (!existing) {
        grouped.set(channel, {
          channel,
          patientCount,
          totalRevenueEur: totalRev,
          avgLtvEur: patientCount > 0 ? totalRev / patientCount : null,
        });
      } else {
        existing.patientCount += patientCount;
        existing.totalRevenueEur += totalRev;
      }
    }
    for (const v of grouped.values()) {
      v.avgLtvEur =
        v.patientCount > 0 ? Number((v.totalRevenueEur / v.patientCount).toFixed(2)) : null;
    }
    return Array.from(grouped.values()).sort(
      (a, b) => (b.avgLtvEur ?? 0) - (a.avgLtvEur ?? 0)
    );
  });
}

export interface RecallRow {
  id: string;
  scheduledFor: string;
  kind: "recall" | "followup" | "review_request";
  status: "pending" | "sent" | "completed" | "skipped";
  note: string | null;
  patientId: string | null;
  patientName: string | null;
  patientEmail: string | null;
  requestId: string | null;
}

export async function recallsDue(
  clinicId: string,
  userId: string,
  withinDays = 30
): Promise<RecallRow[]> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const upper = new Date();
    upper.setDate(upper.getDate() + withinDays);
    const rows = await tx
      .select({
        id: schema.requestRecalls.id,
        scheduledFor: schema.requestRecalls.scheduledFor,
        kind: schema.requestRecalls.kind,
        status: schema.requestRecalls.status,
        note: schema.requestRecalls.note,
        patientId: schema.requestRecalls.patientId,
        patientName: schema.patients.fullName,
        patientEmail: schema.patients.email,
        requestId: schema.requestRecalls.requestId,
      })
      .from(schema.requestRecalls)
      .leftJoin(
        schema.patients,
        eq(schema.requestRecalls.patientId, schema.patients.id)
      )
      .where(
        and(
          eq(schema.requestRecalls.clinicId, clinicId),
          eq(schema.requestRecalls.status, "pending"),
          lte(schema.requestRecalls.scheduledFor, upper.toISOString().slice(0, 10))
        )
      )
      .orderBy(schema.requestRecalls.scheduledFor)
      .limit(20);
    return rows.map((r) => ({
      ...r,
      kind: r.kind as RecallRow["kind"],
      status: r.status as RecallRow["status"],
    }));
  });
}

/** Other requests for the same patient_id, excluding the given request. */
export async function siblingRequests(
  clinicId: string,
  userId: string,
  requestId: string
): Promise<
  Array<{
    id: string;
    treatmentWish: string | null;
    status: string;
    createdAt: Date;
    convertedRevenueEur: number | null;
  }>
> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [target] = await tx
      .select({ patientId: schema.requests.patientId })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);

    if (!target?.patientId) return [];

    const rows = await tx
      .select({
        id: schema.requests.id,
        treatmentWish: schema.requests.treatmentWish,
        status: schema.requests.status,
        createdAt: schema.requests.createdAt,
        convertedRevenueEur: schema.requests.convertedRevenueEur,
      })
      .from(schema.requests)
      .where(
        and(
          eq(schema.requests.clinicId, clinicId),
          eq(schema.requests.patientId, target.patientId),
          ne(schema.requests.id, requestId)
        )
      )
      .orderBy(desc(schema.requests.createdAt))
      .limit(10);

    return rows.map((r) => ({
      ...r,
      convertedRevenueEur:
        r.convertedRevenueEur != null ? Number(r.convertedRevenueEur) : null,
    }));
  });
}

/** Existing recalls for a single request (used on Anfrage detail). */
export async function recallsForRequest(
  clinicId: string,
  userId: string,
  requestId: string
): Promise<
  Array<{ id: string; scheduledFor: string; kind: string; status: string; note: string | null }>
> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const rows = await tx
      .select({
        id: schema.requestRecalls.id,
        scheduledFor: schema.requestRecalls.scheduledFor,
        kind: schema.requestRecalls.kind,
        status: schema.requestRecalls.status,
        note: schema.requestRecalls.note,
      })
      .from(schema.requestRecalls)
      .where(
        and(
          eq(schema.requestRecalls.clinicId, clinicId),
          eq(schema.requestRecalls.requestId, requestId)
        )
      )
      .orderBy(schema.requestRecalls.scheduledFor);
    return rows;
  });
}

/** Aggregate revenue for a single patient (for the Anfrage detail page). */
export async function patientLifetimeRevenue(
  clinicId: string,
  userId: string,
  patientId: string
): Promise<number | null> {
  return withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select({
        ltv: schema.patients.lifetimeRevenueEur,
      })
      .from(schema.patients)
      .where(
        and(
          eq(schema.patients.id, patientId),
          eq(schema.patients.clinicId, clinicId)
        )
      )
      .limit(1);
    return row?.ltv != null ? Number(row.ltv) : null;
  });
}
