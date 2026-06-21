import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * EINS Bewertungen — review-request scheduling.
 *
 * A completed encounter schedules a single post-visit review email. The only
 * caller today is the PVS-bridge derive worker
 * (maybeScheduleReviewForCompletedEncounter in pvs-status-derive.ts), which
 * resolves the clinic, patient, and email and then hands off to
 * scheduleReviewRequest below. The legacy Make.com inbound webhook
 * (/api/patients/events -> applyPatientEvent) was removed once the PVS bridge
 * became the sole review trigger.
 *
 * Anti-spam: a patient gets at most one review_request per ANTI_SPAM_DAYS.
 * Matches §7 UWG ("wiederholt nicht zumutbar") and protects clinic
 * reputation against patients getting two-emails-in-a-week if a PMS replays.
 */

const ANTI_SPAM_DAYS = 90;
const REVIEW_TOKEN_BYTES = 32;
/**
 * Hard window for review tokens. Tokens older than this are rejected by
 * resolveReviewToken — see migration 0035. 90 days matches the typical
 * review-request follow-up cadence and limits the bounty for leaked URLs.
 */
const REVIEW_TOKEN_TTL_DAYS = 90;

/**
 * Inputs to {@link scheduleReviewRequest}. The PVS derive worker
 * (maybeScheduleReviewForCompletedEncounter) calls this with an
 * already-resolved clinic, patient row, and email.
 */
export interface ScheduleReviewRequestArgs {
  clinicId: string;
  patientId: string;
  /** Patient email; normalized (trim + lowercase) inside the helper. */
  email: string;
  patientName?: string | null;
  treatmentLabel?: string | null;
  /**
   * Visit completion time. The per-clinic delay is added to it to compute
   * `scheduled_for`. Defaults to "now" when null.
   */
  completedAt?: Date | null;
  /** Per-clinic delay in days (`clinics.reviewRequestDelayDays`). */
  delayDays: number;
  /**
   * PVS linkage supplied by the derive worker. When `pvsAppointmentId` is set
   * the helper adds a per-appointment idempotency guard (pre-check + the 0058
   * unique index) so a re-derived encounter never schedules a second email.
   */
  requestId?: string | null;
  pvsAppointmentId?: string | null;
  pvsEncounterId?: string | null;
}

export type ScheduleReviewRequestResult =
  | { status: "scheduled"; reviewRequestId: string; scheduledFor: string }
  | { status: "deduped" };

/**
 * Schedule a single review-request row. Collapses to `deduped` (a no-op) when
 * the patient is suppressed, when an earlier review for the same patient is
 * still inside the anti-spam window, or when a review already exists for this
 * PVS appointment.
 *
 * Caller responsibilities (NOT done here): resolving the clinic + its feature
 * flags, resolving/normalizing the patient, and enforcing consent. This helper
 * assumes the decision to send has already been made.
 */
export async function scheduleReviewRequest(
  args: ScheduleReviewRequestArgs
): Promise<ScheduleReviewRequestResult> {
  const email = args.email.trim().toLowerCase();

  // a) Skip if suppressed.
  const [suppressed] = await db
    .select({ id: schema.emailSuppression.id })
    .from(schema.emailSuppression)
    .where(
      and(
        eq(schema.emailSuppression.clinicId, args.clinicId),
        eq(schema.emailSuppression.email, email)
      )
    )
    .limit(1);
  if (suppressed) {
    return { status: "deduped" };
  }

  // b) Per-appointment idempotency (PVS path). A completed encounter is
  //    re-derived on every later event for the patient; without this a single
  //    visit would re-schedule once the anti-spam window in (c) lapses.
  if (args.pvsAppointmentId) {
    const [existingAppt] = await db
      .select({ id: schema.reviewEmailSchedule.id })
      .from(schema.reviewEmailSchedule)
      .where(
        and(
          eq(schema.reviewEmailSchedule.clinicId, args.clinicId),
          eq(
            schema.reviewEmailSchedule.pvsAppointmentId,
            args.pvsAppointmentId
          )
        )
      )
      .limit(1);
    if (existingAppt) {
      return { status: "deduped" };
    }
  }

  // c) Anti-spam — collapse to a no-op if a review-request for this patient
  //    was created within the last ANTI_SPAM_DAYS.
  const cutoff = new Date(Date.now() - ANTI_SPAM_DAYS * 24 * 60 * 60 * 1000);
  const [recentRequest] = await db
    .select({ id: schema.reviewEmailSchedule.id })
    .from(schema.reviewEmailSchedule)
    .where(
      and(
        eq(schema.reviewEmailSchedule.clinicId, args.clinicId),
        eq(schema.reviewEmailSchedule.patientId, args.patientId),
        eq(schema.reviewEmailSchedule.kind, "review_request"),
        gt(schema.reviewEmailSchedule.createdAt, cutoff)
      )
    )
    .orderBy(desc(schema.reviewEmailSchedule.createdAt))
    .limit(1);
  if (recentRequest) {
    return { status: "deduped" };
  }

  // d) Schedule the new review-request email.
  const baseDate = args.completedAt ?? new Date(); // default: now
  const scheduledFor = new Date(baseDate);
  scheduledFor.setUTCDate(scheduledFor.getUTCDate() + args.delayDays);
  const scheduledForStr = toDateOnly(scheduledFor);

  const reviewToken = randomBytes(REVIEW_TOKEN_BYTES).toString("hex");
  const reviewTokenExpiresAt = new Date(
    Date.now() + REVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const [row] = await db
    .insert(schema.reviewEmailSchedule)
    .values({
      clinicId: args.clinicId,
      requestId: args.requestId ?? null,
      patientId: args.patientId,
      kind: "review_request",
      status: "pending",
      scheduledFor: scheduledForStr,
      reviewToken,
      reviewTokenExpiresAt,
      reviewEmail: email,
      reviewPatientName: args.patientName ?? null,
      reviewTreatmentLabel: args.treatmentLabel ?? null,
      pvsAppointmentId: args.pvsAppointmentId ?? null,
      pvsEncounterId: args.pvsEncounterId ?? null,
    })
    // Idempotency backstop: if a concurrent derive scheduled the same
    // appointment between the pre-check in (b) and here, the 0058 unique
    // index makes this a no-op. A NULL pvs_appointment_id never conflicts.
    .onConflictDoNothing({
      target: [
        schema.reviewEmailSchedule.clinicId,
        schema.reviewEmailSchedule.pvsAppointmentId,
      ],
    })
    .returning({ id: schema.reviewEmailSchedule.id });

  if (!row) {
    return { status: "deduped" };
  }

  return {
    status: "scheduled",
    reviewRequestId: row.id,
    scheduledFor: scheduledForStr,
  };
}

/** Mark `email` as unsubscribed for `clinicId`. Idempotent. */
export async function unsubscribePatient(
  clinicId: string,
  rawEmail: string,
  reason: "unsubscribed" | "manual"
): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (!email) return;
  await db
    .insert(schema.emailSuppression)
    .values({ clinicId, email, reason })
    .onConflictDoNothing({
      target: [
        schema.emailSuppression.clinicId,
        schema.emailSuppression.email,
      ],
    });
  // Mirror on the patient row so the inbox shows the unsubscribe state.
  await db
    .update(schema.patients)
    .set({ reviewEmailUnsubscribedAt: new Date() })
    .where(
      and(
        eq(schema.patients.clinicId, clinicId),
        eq(schema.patients.email, email)
      )
    );
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
