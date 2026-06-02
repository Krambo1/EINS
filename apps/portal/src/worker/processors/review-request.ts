import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { renderReviewRequestEmail } from "@/server/email/templates/review-request";
import { env } from "@/lib/env";

/**
 * EINS Bewertungen — review-request scanner.
 *
 * Runs every 15 min (BullMQ repeat). Selects all due review-request rows
 * from review_email_schedule that are still pending, looks up the patient +
 * clinic context, and enqueues an emailSend job. The worker uses the
 * existing email-send processor which already routes through the configured
 * driver (console / mailhog / Resend) — no special-casing here.
 *
 * Idempotency: every schedule row is flipped from 'pending' → 'sent' inside
 * the SAME tick, BEFORE the email-send job is enqueued. If we enqueue first
 * and the worker crashes between enqueue and update, BullMQ replays the job
 * and the patient gets a duplicate email. Updating first means at-most-once
 * delivery; the tradeoff is acceptable for review requests (a patient
 * missing a single review email is fine; receiving two looks broken).
 *
 * Suppression check runs in-tick: a clinic admin may add an entry to
 * email_suppression between the row being scheduled and the send tick.
 */
export type ReviewRequestTickJob = Record<string, never>;

const BATCH_LIMIT = 200;

export async function processReviewRequestTick(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Pull due rows with the joins we need to render the mail in one round-trip.
  type DueRow = {
    reviewRequestId: string;
    reviewToken: string;
    reviewEmail: string;
    reviewPatientName: string | null;
    reviewTreatmentLabel: string | null;
    clinicId: string;
    clinicDisplayName: string;
    googleReviewUrl: string | null;
    jamedaReviewUrl: string | null;
    reviewLandingOrigin: string | null;
    reviewEmailFrom: string | null;
    reviewRequestEnabled: boolean;
  };

  const due = (await db
    .select({
      reviewRequestId: schema.reviewEmailSchedule.id,
      reviewToken: schema.reviewEmailSchedule.reviewToken,
      reviewEmail: schema.reviewEmailSchedule.reviewEmail,
      reviewPatientName: schema.reviewEmailSchedule.reviewPatientName,
      reviewTreatmentLabel: schema.reviewEmailSchedule.reviewTreatmentLabel,
      clinicId: schema.clinics.id,
      clinicDisplayName: schema.clinics.displayName,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
      reviewLandingOrigin: schema.clinics.reviewLandingOrigin,
      reviewEmailFrom: schema.clinics.reviewEmailFrom,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
    })
    .from(schema.reviewEmailSchedule)
    .innerJoin(
      schema.clinics,
      eq(schema.reviewEmailSchedule.clinicId, schema.clinics.id)
    )
    .where(
      and(
        eq(schema.reviewEmailSchedule.kind, "review_request"),
        eq(schema.reviewEmailSchedule.status, "pending"),
        lte(schema.reviewEmailSchedule.scheduledFor, today),
        isNotNull(schema.reviewEmailSchedule.reviewToken),
        isNotNull(schema.reviewEmailSchedule.reviewEmail)
      )
    )
    .limit(BATCH_LIMIT)) as DueRow[];

  if (due.length === 0) {
    console.log("[review-request] tick: nothing due");
    return;
  }

  console.log(`[review-request] tick: ${due.length} due rows`);

  for (const row of due) {
    try {
      await sendOne(row);
    } catch (err) {
      console.error(
        `[review-request] send failed reviewRequestId=${row.reviewRequestId}:`,
        err
      );
      // Roll back to 'pending' so the next tick retries. Without the rollback
      // the row would stay 'sent' with no email actually delivered.
      await db
        .update(schema.reviewEmailSchedule)
        .set({ status: "pending" })
        .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    }
  }
}

async function sendOne(row: {
  reviewRequestId: string;
  reviewToken: string;
  reviewEmail: string;
  reviewPatientName: string | null;
  reviewTreatmentLabel: string | null;
  clinicId: string;
  clinicDisplayName: string;
  googleReviewUrl: string | null;
  jamedaReviewUrl: string | null;
  reviewLandingOrigin: string | null;
  reviewEmailFrom: string | null;
  reviewRequestEnabled: boolean;
}): Promise<void> {
  // Re-check feature flag — admin may have flipped it off after scheduling.
  if (!row.reviewRequestEnabled) {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "feature_disabled" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return;
  }

  // Check suppression.
  const [suppressed] = await db
    .select({ id: schema.emailSuppression.id })
    .from(schema.emailSuppression)
    .where(
      and(
        eq(schema.emailSuppression.clinicId, row.clinicId),
        eq(schema.emailSuppression.email, row.reviewEmail.toLowerCase())
      )
    )
    .limit(1);
  if (suppressed) {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "suppressed" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return;
  }

  // Refuse to send if the clinic hasn't configured at least one public review URL.
  // Without it the landing page would render an empty CTA. Better to skip
  // than to email a patient and dead-end them.
  if (!row.googleReviewUrl && !row.jamedaReviewUrl) {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "no_review_url" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return;
  }

  // Pick the landing origin — clinic-specific if configured, otherwise the
  // global CLINIC_LANDING_ORIGIN default so dev still works without admin setup.
  const landingOrigin = row.reviewLandingOrigin ?? env.CLINIC_LANDING_ORIGIN;

  // The renderer accepts richer context (appointmentDate, practiceSpecialty,
  // practiceLocation, practitionerName) than we currently persist on
  // review_email_schedule. Pass null for those — the template degrades
  // gracefully (drops the lockup sub-line, drops the visit-card cells,
  // drops the date in the body intro / footer reminder). Future schema work
  // would:
  //   1. add reviewVisitDate to review_email_schedule (persist
  //      patient_event.appointmentCompletedAt) — easy win
  //   2. add specialty / locationLabel columns on clinics — config UI
  //   3. extend the PMS Make webhook to carry practitionerName onto the
  //      patient_event and onto review_email_schedule
  const rendered = renderReviewRequestEmail({
    clinicName: row.clinicDisplayName,
    patientName: row.reviewPatientName,
    treatmentLabel: row.reviewTreatmentLabel,
    appointmentDate: null,
    practiceSpecialty: null,
    practiceLocation: null,
    practitionerName: null,
    landingOrigin: landingOrigin.replace(/\/$/, ""),
    token: row.reviewToken,
  });

  // Mark sent BEFORE enqueueing — see module header comment for rationale.
  await db
    .update(schema.reviewEmailSchedule)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));

  // Enqueue the actual delivery via the existing email-send queue.
  // Marketing-class send: every suppression reason blocks (the worker's
  // initial check above catches existing rows, but the queue check
  // catches a window where suppression lands between the two).
  // List-Unsubscribe header points to the same /r/unsubscribe path the
  // email body uses — Gmail/Yahoo one-click goes through this URL.
  const unsubscribeUrl = `${landingOrigin.replace(/\/$/, "")}/r/unsubscribe?token=${encodeURIComponent(row.reviewToken)}`;
  const { enqueueEmail } = await import("@/server/jobs");
  await enqueueEmail({
    to: row.reviewEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    clinicId: row.clinicId,
    klass: "marketing",
    unsubscribeUrl,
  });
}
