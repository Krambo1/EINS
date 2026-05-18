import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { unsubscribePatient } from "@/server/patient-events";
import { enqueueEmail } from "@/server/jobs";
import { env } from "@/lib/env";
import { renderFeedbackAlertEmail } from "@/server/email/templates/feedback-alert";

/**
 * EINS Stimme — server-side functions backing /api/review-tokens/[token]/*.
 *
 * The token (32-byte hex from `crypto.randomBytes(32)`) is the entire
 * credential — anyone holding it can resolve the clinic context, record a
 * click, post feedback, or unsubscribe the patient. That's intentional: it's
 * the same trust model as a single-use email magic link, and the data
 * exposed is bounded (one clinic's public review URLs + one patient's
 * private feedback). Abuse vectors are mitigated by:
 *   • IP rate-limit at the route layer
 *   • Audit log on every state change
 *   • Token-level once-only semantics on first rating click
 */

const TOKEN_REGEX = /^[a-f0-9]{64}$/i;

export function isValidTokenShape(t: string): boolean {
  return TOKEN_REGEX.test(t);
}

type RecallWithClinic = {
  recallId: string;
  clinicId: string;
  clinicName: string;
  googleReviewUrl: string | null;
  jamedaReviewUrl: string | null;
  reviewRequestEnabled: boolean;
  patientId: string | null;
  patientName: string | null;
  patientEmail: string | null;
  ratingValue: number | null;
  ratingClickedAt: Date | null;
  publicClickedAt: Date | null;
  feedbackAt: Date | null;
  reviewInboxEmail: string | null;
  defaultDoctorEmail: string | null;
};

export async function resolveReviewToken(
  token: string
): Promise<RecallWithClinic | null> {
  if (!isValidTokenShape(token)) return null;

  const [row] = await db
    .select({
      recallId: schema.requestRecalls.id,
      clinicId: schema.clinics.id,
      clinicName: schema.clinics.displayName,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      reviewInboxEmail: schema.clinics.reviewInboxEmail,
      defaultDoctorEmail: schema.clinics.defaultDoctorEmail,
      patientId: schema.requestRecalls.patientId,
      patientName: schema.requestRecalls.reviewPatientName,
      patientEmail: schema.requestRecalls.reviewEmail,
      ratingValue: schema.requestRecalls.ratingValue,
      ratingClickedAt: schema.requestRecalls.ratingClickedAt,
      publicClickedAt: schema.requestRecalls.publicClickedAt,
      feedbackAt: schema.requestRecalls.feedbackAt,
    })
    .from(schema.requestRecalls)
    .innerJoin(
      schema.clinics,
      eq(schema.requestRecalls.clinicId, schema.clinics.id)
    )
    .where(eq(schema.requestRecalls.reviewToken, token))
    .limit(1);
  return row ?? null;
}

/**
 * Record the first 1..5 rating click. Once a rating is stored it is the
 * patient's truth; a second click (e.g. the patient revisits the email on
 * another device) doesn't change `rating_value` but does refresh
 * `rating_clicked_at`. Implemented as a single SQL statement so the two
 * fields stay consistent under concurrent revisits.
 */
export async function recordRatingClick(
  token: string,
  rating: number
): Promise<{ ok: boolean }> {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false };
  }
  if (!isValidTokenShape(token)) return { ok: false };

  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    UPDATE request_recalls
       SET rating_clicked_at = now(),
           rating_value      = COALESCE(rating_value, ${rating})
     WHERE review_token = ${token}
       AND kind         = 'review_request'
  `);
  return { ok: true };
}

/**
 * Record that the patient clicked the public review CTA. Touches the
 * recall but does NOT change status — the patient may still come back
 * and submit private feedback. Status flips to 'completed' only when
 * private feedback is submitted, mirroring the same end-state.
 *
 * Also persists a `patient_feedback` row with source='public_redirect' so
 * the Praxis sees every rating that engaged with the request in one inbox,
 * not just the private ones. Idempotent per recall: if the patient clicks
 * Google and later comes back and clicks Jameda, the existing row is
 * updated in place (one row per recall, last platform wins). No alert
 * email is fired — public clicks are positive-leaning signals and the
 * sync workers will pick up the actual Google/Jameda review separately.
 */
export async function recordPublicClick(
  token: string,
  platform: "google" | "jameda"
): Promise<{ ok: boolean }> {
  if (!isValidTokenShape(token)) return { ok: false };

  const recall = await resolveReviewToken(token);
  if (!recall) return { ok: false };

  await db
    .update(schema.requestRecalls)
    .set({
      publicClickedAt: new Date(),
      publicClickedPlatform: platform,
    })
    .where(eq(schema.requestRecalls.id, recall.recallId));

  // Persist the public-redirect feedback row. We need a rating to satisfy
  // patient_feedback.rating NOT NULL — if for some reason the patient hit
  // /go without ever recording a rating, skip the inbox entry rather than
  // invent one.
  if (recall.ratingValue !== null) {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO patient_feedback (
        clinic_id,
        patient_id,
        recall_id,
        rating,
        contact_email,
        contact_name,
        source,
        public_platform
      ) VALUES (
        ${recall.clinicId},
        ${recall.patientId},
        ${recall.recallId},
        ${recall.ratingValue},
        ${recall.patientEmail},
        ${recall.patientName},
        'public_redirect',
        ${platform}
      )
      ON CONFLICT (recall_id) WHERE source = 'public_redirect'
      DO UPDATE SET
        public_platform = EXCLUDED.public_platform,
        rating          = EXCLUDED.rating
    `);
  }

  return { ok: true };
}

export interface FeedbackSubmission {
  rating: number;
  freeText: string | null;
  contactBackOk: boolean;
  contactName: string | null;
  contactEmail: string | null;
}

/**
 * Persist a private feedback submission. Returns the new patient_feedback
 * row id (used to deep-link from the alert email).
 *
 * Side effects: enqueues a feedback-alert email to the Praxisinhaber:in
 * (review_inbox_email → default_doctor_email → skip).
 */
export async function recordFeedback(
  token: string,
  submission: FeedbackSubmission
): Promise<{ ok: boolean; feedbackId?: string }> {
  if (!isValidTokenShape(token)) return { ok: false };
  if (
    !Number.isInteger(submission.rating) ||
    submission.rating < 1 ||
    submission.rating > 5
  ) {
    return { ok: false };
  }

  const recall = await resolveReviewToken(token);
  if (!recall) return { ok: false };

  const [row] = await db
    .insert(schema.patientFeedback)
    .values({
      clinicId: recall.clinicId,
      patientId: recall.patientId,
      recallId: recall.recallId,
      rating: submission.rating,
      freeText: submission.freeText?.slice(0, 5000) ?? null,
      contactBackOk: submission.contactBackOk,
      contactEmail: submission.contactEmail ?? recall.patientEmail ?? null,
      contactName: submission.contactName ?? recall.patientName ?? null,
    })
    .returning({ id: schema.patientFeedback.id });

  await db
    .update(schema.requestRecalls)
    .set({
      feedbackAt: new Date(),
      status: "completed",
      ratingValue: submission.rating,
    })
    .where(eq(schema.requestRecalls.id, recall.recallId));

  // Alert the Praxis. Best-effort — failure must not break the patient flow.
  try {
    const inbox = recall.reviewInboxEmail ?? recall.defaultDoctorEmail;
    if (inbox) {
      const rendered = renderFeedbackAlertEmail({
        clinicName: recall.clinicName,
        portalOrigin: env.APP_ORIGIN,
        feedbackId: row!.id,
        rating: submission.rating,
        freeText: submission.freeText ?? null,
        patientName: submission.contactName ?? recall.patientName ?? null,
        patientEmail: submission.contactEmail ?? recall.patientEmail ?? null,
        contactBackOk: submission.contactBackOk,
      });
      await enqueueEmail({
        to: inbox,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      });
    } else {
      console.warn(
        `[review-tokens] no inbox configured for clinic=${recall.clinicId}, feedback ${row!.id} not alerted`
      );
    }
  } catch (err) {
    console.error("[review-tokens] alert enqueue failed:", err);
  }

  return { ok: true, feedbackId: row!.id };
}

/**
 * Unsubscribe the patient whose recall this token belongs to. Adds an
 * email_suppression row and tombstones the patient.
 */
export async function unsubscribeViaToken(
  token: string
): Promise<{ ok: boolean; clinicName?: string }> {
  if (!isValidTokenShape(token)) return { ok: false };
  const recall = await resolveReviewToken(token);
  if (!recall || !recall.patientEmail) return { ok: false };
  await unsubscribePatient(recall.clinicId, recall.patientEmail, "unsubscribed");
  return { ok: true, clinicName: recall.clinicName };
}
