import { and, eq, isNotNull, lte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { renderReviewRequestEmail } from "@/server/email/templates/review-request";
import { env } from "@/lib/env";

/**
 * EINS Stimme — review-request scanner.
 *
 * Runs every 15 min (BullMQ repeat). Selects all due review_request recalls
 * that are still pending, looks up the patient + clinic context, and
 * enqueues an emailSend job. The worker uses the existing email-send
 * processor which already routes through the configured driver (console /
 * mailhog / Resend) — no special-casing here.
 *
 * Idempotency: every recall row is flipped from 'pending' → 'sent' inside
 * the SAME tick, BEFORE the email-send job is enqueued. If we enqueue first
 * and the worker crashes between enqueue and update, BullMQ replays the job
 * and the patient gets a duplicate email. Updating first means at-most-once
 * delivery; the tradeoff is acceptable for review requests (a patient
 * missing a single review email is fine; receiving two looks broken).
 *
 * Suppression check runs in-tick: a clinic admin may add an entry to
 * email_suppression between the recall being scheduled and the send tick.
 */
export type ReviewRequestTickJob = Record<string, never>;

const BATCH_LIMIT = 200;

export async function processReviewRequestTick(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  // Pull due rows with the joins we need to render the mail in one round-trip.
  type DueRow = {
    recallId: string;
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
      recallId: schema.requestRecalls.id,
      reviewToken: schema.requestRecalls.reviewToken,
      reviewEmail: schema.requestRecalls.reviewEmail,
      reviewPatientName: schema.requestRecalls.reviewPatientName,
      reviewTreatmentLabel: schema.requestRecalls.reviewTreatmentLabel,
      clinicId: schema.clinics.id,
      clinicDisplayName: schema.clinics.displayName,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
      reviewLandingOrigin: schema.clinics.reviewLandingOrigin,
      reviewEmailFrom: schema.clinics.reviewEmailFrom,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
    })
    .from(schema.requestRecalls)
    .innerJoin(
      schema.clinics,
      eq(schema.requestRecalls.clinicId, schema.clinics.id)
    )
    .where(
      and(
        eq(schema.requestRecalls.kind, "review_request"),
        eq(schema.requestRecalls.status, "pending"),
        lte(schema.requestRecalls.scheduledFor, today),
        isNotNull(schema.requestRecalls.reviewToken),
        isNotNull(schema.requestRecalls.reviewEmail)
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
        `[review-request] send failed recall=${row.recallId}:`,
        err
      );
      // Roll back to 'pending' so the next tick retries. Without the rollback
      // the row would stay 'sent' with no email actually delivered.
      await db
        .update(schema.requestRecalls)
        .set({ status: "pending" })
        .where(eq(schema.requestRecalls.id, row.recallId));
    }
  }
}

async function sendOne(row: {
  recallId: string;
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
      .update(schema.requestRecalls)
      .set({ status: "skipped", note: "feature_disabled" })
      .where(eq(schema.requestRecalls.id, row.recallId));
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
      .update(schema.requestRecalls)
      .set({ status: "skipped", note: "suppressed" })
      .where(eq(schema.requestRecalls.id, row.recallId));
    return;
  }

  // Refuse to send if the clinic hasn't configured at least one public review URL.
  // Without it the landing page would render an empty CTA. Better to skip
  // than to email a patient and dead-end them.
  if (!row.googleReviewUrl && !row.jamedaReviewUrl) {
    await db
      .update(schema.requestRecalls)
      .set({ status: "skipped", note: "no_review_url" })
      .where(eq(schema.requestRecalls.id, row.recallId));
    return;
  }

  // Pick the landing origin — clinic-specific if configured, otherwise the
  // global CLINIC_LANDING_ORIGIN default so dev still works without admin setup.
  const landingOrigin = row.reviewLandingOrigin ?? env.CLINIC_LANDING_ORIGIN;

  const rendered = renderReviewRequestEmail({
    clinicName: row.clinicDisplayName,
    patientName: row.reviewPatientName,
    treatmentLabel: row.reviewTreatmentLabel,
    landingOrigin: landingOrigin.replace(/\/$/, ""),
    token: row.reviewToken,
  });

  // Mark sent BEFORE enqueueing — see module header comment for rationale.
  await db
    .update(schema.requestRecalls)
    .set({ status: "sent", sentAt: new Date() })
    .where(eq(schema.requestRecalls.id, row.recallId));

  // Enqueue the actual delivery via the existing email-send queue.
  const { enqueueEmail } = await import("@/server/jobs");
  await enqueueEmail({
    to: row.reviewEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  });
}

