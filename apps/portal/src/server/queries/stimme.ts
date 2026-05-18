import "server-only";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { db, schema, withClinicContext } from "@/db/client";
import type { PatientFeedbackStatus } from "@/lib/constants";

/**
 * Server-side queries backing the /stimme private-feedback inbox and the
 * dashboard "Stimme" tile. All queries scope by `clinicId` and pass through
 * `withClinicContext` so RLS is enforced even on the app DB role.
 */

export type PatientFeedbackSource = "private" | "public_redirect";
export type PatientFeedbackPublicPlatform = "google" | "jameda";

export interface StimmeListRow {
  id: string;
  rating: number;
  freeText: string | null;
  contactBackOk: boolean;
  contactName: string | null;
  contactEmail: string | null;
  status: PatientFeedbackStatus;
  source: PatientFeedbackSource;
  publicPlatform: PatientFeedbackPublicPlatform | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export async function listPatientFeedback(
  clinicId: string,
  userId: string,
  filter?: { status?: PatientFeedbackStatus }
): Promise<StimmeListRow[]> {
  return await withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const where = filter?.status
        ? eq(schema.patientFeedback.status, filter.status)
        : undefined;
      const rows = await tx
        .select({
          id: schema.patientFeedback.id,
          rating: schema.patientFeedback.rating,
          freeText: schema.patientFeedback.freeText,
          contactBackOk: schema.patientFeedback.contactBackOk,
          contactName: schema.patientFeedback.contactName,
          contactEmail: schema.patientFeedback.contactEmail,
          status: schema.patientFeedback.status,
          source: schema.patientFeedback.source,
          publicPlatform: schema.patientFeedback.publicPlatform,
          createdAt: schema.patientFeedback.createdAt,
          resolvedAt: schema.patientFeedback.resolvedAt,
        })
        .from(schema.patientFeedback)
        .where(where)
        .orderBy(desc(schema.patientFeedback.createdAt))
        .limit(200);
      return rows as StimmeListRow[];
    },
    "stimme:list"
  );
}

/**
 * Auto-transitions a private patient_feedback row from 'neu' to 'gesehen'
 * the first time the detail page is opened. Idempotent — the WHERE only
 * fires on `status = 'neu'`, so re-opens are no-ops. Best-effort: failures
 * are swallowed so a transient write never breaks the detail render.
 *
 * Only applies to `source = 'private'` rows because `public_redirect`
 * rows are informational; their status is managed by the platform-sync
 * workers, not by user views.
 */
export async function markPatientFeedbackSeen(
  clinicId: string,
  userId: string,
  id: string
): Promise<void> {
  try {
    await withClinicContext(
      clinicId,
      userId,
      (tx) =>
        tx
          .update(schema.patientFeedback)
          .set({ status: "gesehen" })
          .where(
            and(
              eq(schema.patientFeedback.id, id),
              eq(schema.patientFeedback.clinicId, clinicId),
              eq(schema.patientFeedback.source, "private"),
              eq(schema.patientFeedback.status, "neu")
            )
          ),
      "stimme:mark-seen"
    );
  } catch {
    // Non-critical — silently drop.
  }
}

/**
 * Count of untouched private patient feedback (status = 'neu', source =
 * 'private') — drives the sidebar Bewertungen / Patientenfeedback badge.
 * Goes down as soon as the user marks feedback as gesehen/beantwortet.
 */
export async function countNewPatientFeedback(
  clinicId: string,
  userId: string
): Promise<number> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [row] = await tx
        .select({ c: count() })
        .from(schema.patientFeedback)
        .where(
          and(
            eq(schema.patientFeedback.clinicId, clinicId),
            eq(schema.patientFeedback.source, "private"),
            eq(schema.patientFeedback.status, "neu")
          )
        );
      return Number(row?.c ?? 0);
    },
    "stimme:count-new"
  );
}

export interface StimmeDetail extends StimmeListRow {
  internalNote: string | null;
  resolvedBy: string | null;
  recallTreatmentLabel: string | null;
  recallScheduledFor: string | null;
}

export async function getPatientFeedback(
  clinicId: string,
  userId: string,
  id: string
): Promise<StimmeDetail | null> {
  return await withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [row] = await tx
        .select({
          id: schema.patientFeedback.id,
          rating: schema.patientFeedback.rating,
          freeText: schema.patientFeedback.freeText,
          contactBackOk: schema.patientFeedback.contactBackOk,
          contactName: schema.patientFeedback.contactName,
          contactEmail: schema.patientFeedback.contactEmail,
          status: schema.patientFeedback.status,
          source: schema.patientFeedback.source,
          publicPlatform: schema.patientFeedback.publicPlatform,
          createdAt: schema.patientFeedback.createdAt,
          resolvedAt: schema.patientFeedback.resolvedAt,
          internalNote: schema.patientFeedback.internalNote,
          resolvedBy: schema.patientFeedback.resolvedBy,
          recallTreatmentLabel: schema.requestRecalls.reviewTreatmentLabel,
          recallScheduledFor: schema.requestRecalls.scheduledFor,
        })
        .from(schema.patientFeedback)
        .leftJoin(
          schema.requestRecalls,
          eq(schema.patientFeedback.recallId, schema.requestRecalls.id)
        )
        .where(eq(schema.patientFeedback.id, id))
        .limit(1);
      if (!row) return null;
      return row as StimmeDetail;
    },
    "stimme:detail"
  );
}

/**
 * Stimme-tile metrics for the dashboard. Last `windowDays` of recall sends,
 * click-through, public clicks, and OPEN private feedback count.
 *
 * Queries run on the superuser connection (no RLS) but always WHERE clinic.
 */
export async function stimmeDashboardMetrics(
  clinicId: string,
  windowDays = 30
): Promise<{
  requestsSent: number;
  ratingClicks: number;
  publicClicks: number;
  openPrivate: number;
  windowDays: number;
}> {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [sentRow] = await db
    .select({ c: count() })
    .from(schema.requestRecalls)
    .where(
      and(
        eq(schema.requestRecalls.clinicId, clinicId),
        eq(schema.requestRecalls.kind, "review_request"),
        gte(schema.requestRecalls.sentAt, cutoff)
      )
    );
  const [ratingRow] = await db
    .select({ c: count() })
    .from(schema.requestRecalls)
    .where(
      and(
        eq(schema.requestRecalls.clinicId, clinicId),
        eq(schema.requestRecalls.kind, "review_request"),
        gte(schema.requestRecalls.ratingClickedAt, cutoff)
      )
    );
  const [publicRow] = await db
    .select({ c: count() })
    .from(schema.requestRecalls)
    .where(
      and(
        eq(schema.requestRecalls.clinicId, clinicId),
        eq(schema.requestRecalls.kind, "review_request"),
        gte(schema.requestRecalls.publicClickedAt, cutoff)
      )
    );
  // Open count is for *actionable* items — private feedback awaiting
  // triage. Public-redirect rows live in the same table for unified
  // visibility but they're informational, not a to-do.
  const [openRow] = await db
    .select({ c: count() })
    .from(schema.patientFeedback)
    .where(
      and(
        eq(schema.patientFeedback.clinicId, clinicId),
        eq(schema.patientFeedback.source, "private"),
        sql`${schema.patientFeedback.status} IN ('neu','gesehen')`
      )
    );

  return {
    requestsSent: Number(sentRow?.c ?? 0),
    ratingClicks: Number(ratingRow?.c ?? 0),
    publicClicks: Number(publicRow?.c ?? 0),
    openPrivate: Number(openRow?.c ?? 0),
    windowDays,
  };
}
