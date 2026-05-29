import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * EINS Stimme — inbound PMS event handler.
 *
 * Make.com (per-clinic scenario) translates each PMS's native webhook into
 * a canonical envelope and POSTs it to /api/patients/events. This module
 * is the business-logic side of that route — kept out of the route file so
 * tests can drive it without faking an HTTP request.
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

export interface PatientEventInput {
  clinicId: string;
  eventKind:
    | "appointment_completed"
    | "patient_consent_given"
    | "patient_unsubscribed";
  patient: {
    email: string;
    fullName?: string | null;
    phone?: string | null;
    externalId?: string | null;
  };
  appointmentCompletedAt?: Date | null;
  locationId?: string | null;
  treatmentLabel?: string | null;
  /**
   * Praxis attests via Make field: "We informed the patient at intake that
   * we may contact them about a review after the visit." Required for review
   * sends. Without it we hard-reject — DSGVO Art. 6(1)(f) needs a legitimate
   * interest + balancing test that the Praxis can defend.
   */
  reviewConsent: boolean;
}

export type PatientEventResult =
  | { ok: true; status: "scheduled"; reviewRequestId: string; scheduledFor: string }
  | { ok: true; status: "consent_recorded" }
  | { ok: true; status: "unsubscribed" }
  | { ok: true; status: "deduped" }
  | { ok: true; status: "feature_disabled" }
  | { ok: false; reason: "clinic_not_found" | "consent_missing" | "email_missing" };

/**
 * Apply a single canonical event. Idempotent on (clinicId, email,
 * scheduledFor) — replays inside the anti-spam window are no-ops.
 */
export async function applyPatientEvent(
  input: PatientEventInput
): Promise<PatientEventResult> {
  // 1) Resolve clinic + program config.
  const [clinic] = await db
    .select({
      id: schema.clinics.id,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      reviewRequestDelayDays: schema.clinics.reviewRequestDelayDays,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, input.clinicId))
    .limit(1);
  if (!clinic) {
    return { ok: false, reason: "clinic_not_found" };
  }

  const email = input.patient.email.trim().toLowerCase();
  if (!email) {
    return { ok: false, reason: "email_missing" };
  }

  // 2) Branch by event kind.
  if (input.eventKind === "patient_unsubscribed") {
    await unsubscribePatient(input.clinicId, email, "unsubscribed");
    return { ok: true, status: "unsubscribed" };
  }

  if (input.eventKind === "patient_consent_given") {
    // Consent updates don't auto-schedule a review — the subsequent
    // appointment_completed event does. We just persist the patient row
    // so the Praxis can see them in the audit trail.
    await upsertPatient(input);
    return { ok: true, status: "consent_recorded" };
  }

  // appointment_completed below.
  if (!input.reviewConsent) {
    return { ok: false, reason: "consent_missing" };
  }
  if (!clinic.reviewRequestEnabled) {
    return { ok: true, status: "feature_disabled" };
  }

  // 3) Upsert patient row.
  const patientId = await upsertPatient(input);

  // 4) Skip if suppressed.
  const [suppressed] = await db
    .select({ id: schema.emailSuppression.id })
    .from(schema.emailSuppression)
    .where(
      and(
        eq(schema.emailSuppression.clinicId, input.clinicId),
        eq(schema.emailSuppression.email, email)
      )
    )
    .limit(1);
  if (suppressed) {
    return { ok: true, status: "deduped" };
  }

  // 5) Anti-spam — collapse to a no-op if a review-request for this
  //    patient was created within the last ANTI_SPAM_DAYS.
  const cutoff = new Date(Date.now() - ANTI_SPAM_DAYS * 24 * 60 * 60 * 1000);
  const [recentRequest] = await db
    .select({ id: schema.reviewEmailSchedule.id })
    .from(schema.reviewEmailSchedule)
    .where(
      and(
        eq(schema.reviewEmailSchedule.clinicId, input.clinicId),
        eq(schema.reviewEmailSchedule.patientId, patientId),
        eq(schema.reviewEmailSchedule.kind, "review_request"),
        gt(schema.reviewEmailSchedule.createdAt, cutoff)
      )
    )
    .orderBy(desc(schema.reviewEmailSchedule.createdAt))
    .limit(1);
  if (recentRequest) {
    return { ok: true, status: "deduped" };
  }

  // 6) Schedule the new review-request email.
  const baseDate =
    input.appointmentCompletedAt ?? new Date(); // default: now
  const scheduledFor = new Date(baseDate);
  scheduledFor.setUTCDate(
    scheduledFor.getUTCDate() + clinic.reviewRequestDelayDays
  );
  const scheduledForStr = toDateOnly(scheduledFor);

  const reviewToken = randomBytes(REVIEW_TOKEN_BYTES).toString("hex");
  const reviewTokenExpiresAt = new Date(
    Date.now() + REVIEW_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  const [row] = await db
    .insert(schema.reviewEmailSchedule)
    .values({
      clinicId: input.clinicId,
      patientId,
      kind: "review_request",
      status: "pending",
      scheduledFor: scheduledForStr,
      reviewToken,
      reviewTokenExpiresAt,
      reviewEmail: email,
      reviewPatientName: input.patient.fullName ?? null,
      reviewTreatmentLabel: input.treatmentLabel ?? null,
    })
    .returning({ id: schema.reviewEmailSchedule.id });

  return {
    ok: true,
    status: "scheduled",
    reviewRequestId: row!.id,
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

async function upsertPatient(input: PatientEventInput): Promise<string> {
  const email = input.patient.email.trim().toLowerCase();
  const [existing] = await db
    .select({ id: schema.patients.id })
    .from(schema.patients)
    .where(
      and(
        eq(schema.patients.clinicId, input.clinicId),
        eq(schema.patients.email, email)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(schema.patients)
      .set({
        lastSeenAt: new Date(),
        fullName: input.patient.fullName ?? sql`${schema.patients.fullName}`,
        phone: input.patient.phone ?? sql`${schema.patients.phone}`,
        externalId:
          input.patient.externalId ?? sql`${schema.patients.externalId}`,
      })
      .where(eq(schema.patients.id, existing.id));
    return existing.id;
  }

  const [row] = await db
    .insert(schema.patients)
    .values({
      clinicId: input.clinicId,
      email,
      fullName: input.patient.fullName ?? null,
      phone: input.patient.phone ?? null,
      externalId: input.patient.externalId ?? null,
      firstTouchSource: "pms",
    })
    .returning({ id: schema.patients.id });
  return row!.id;
}

function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}
