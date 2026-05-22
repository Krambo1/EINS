import "server-only";
import { and, desc, eq } from "drizzle-orm";
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
  googlePlaceId: string | null;
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
      googlePlaceId: schema.clinics.googlePlaceId,
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
      expiresAt: schema.requestRecalls.reviewTokenExpiresAt,
    })
    .from(schema.requestRecalls)
    .innerJoin(
      schema.clinics,
      eq(schema.requestRecalls.clinicId, schema.clinics.id)
    )
    .where(eq(schema.requestRecalls.reviewToken, token))
    .limit(1);
  if (!row) return null;
  // Hard expiry check. NULL expiresAt means a legacy row that pre-dates
  // migration 0035 — the migration backfills, but defend in code anyway
  // so a missed migration in dev doesn't silently re-open the leak window.
  if (!row.expiresAt || row.expiresAt < new Date()) {
    return null;
  }
  // Strip expiresAt from the public shape — callers don't need it.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { expiresAt: _expiresAt, ...rest } = row;
  return rest;
}

/**
 * Resolve the final URL we want to send a Google reviewer to. The hard
 * requirement: the patient must land on a "Write a review" prompt for the
 * specific Place — never on Google search results. We prefer the Place ID
 * because it produces the canonical `search.google.com/local/writereview`
 * deeplink; fall back to a configured `googleReviewUrl` only when it
 * already looks like a write-review URL (contains "writereview" or the
 * older `g.page/.../review` short link). A search URL is rejected.
 */
export function resolveGoogleReviewTarget(input: {
  googlePlaceId: string | null;
  googleReviewUrl: string | null;
}): string | null {
  if (input.googlePlaceId && input.googlePlaceId.trim().length > 0) {
    return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(
      input.googlePlaceId.trim()
    )}`;
  }
  const url = input.googleReviewUrl?.trim();
  if (!url) return null;
  if (/\/search\b|search\.google\.com\/search\b/i.test(url)) return null;
  if (/writereview|g\.page\b|\/review\b|maps\.app\.goo\.gl\b/i.test(url)) {
    return url;
  }
  return null;
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

export type RecordFeedbackResult =
  | { ok: true; feedbackId: string; replayed: boolean }
  | { ok: false; reason: "invalid" | "not_found" | "unsubscribed" };

/**
 * Persist a private feedback submission. Returns the new patient_feedback
 * row id (used to deep-link from the alert email).
 *
 * Idempotency: at most one private feedback row per recall. A second POST
 * with a valid token short-circuits to the existing row (replayed=true) and
 * does NOT fire a duplicate alert email. The migration 0032 partial unique
 * index closes the race window where two concurrent POSTs slip past the
 * application-side check.
 *
 * Suppression: a patient who unsubscribed (via /r/unsubscribe or PMS
 * patient_unsubscribed event) cannot submit feedback. We surface this as
 * `reason: 'unsubscribed'` so the route can return 403 rather than silently
 * accepting and never delivering the alert.
 *
 * Side effects on first call: enqueues a feedback-alert email to the
 * Praxisinhaber:in (review_inbox_email → default_doctor_email → skip).
 */
export async function recordFeedback(
  token: string,
  submission: FeedbackSubmission
): Promise<RecordFeedbackResult> {
  if (!isValidTokenShape(token)) return { ok: false, reason: "invalid" };
  if (
    !Number.isInteger(submission.rating) ||
    submission.rating < 1 ||
    submission.rating > 5
  ) {
    return { ok: false, reason: "invalid" };
  }

  const recall = await resolveReviewToken(token);
  if (!recall) return { ok: false, reason: "not_found" };

  // Suppression gate: an unsubscribed patient may not submit feedback.
  // We check both per-clinic email_suppression (the canonical store) and
  // recall.patientEmail because the email lives only on the recall row when
  // the patient came in via a non-PMS flow.
  const suppressionEmail = recall.patientEmail?.trim().toLowerCase() ?? null;
  if (suppressionEmail) {
    const [suppressed] = await db
      .select({ id: schema.emailSuppression.id })
      .from(schema.emailSuppression)
      .where(
        and(
          eq(schema.emailSuppression.clinicId, recall.clinicId),
          eq(schema.emailSuppression.email, suppressionEmail)
        )
      )
      .limit(1);
    if (suppressed) {
      return { ok: false, reason: "unsubscribed" };
    }
  }

  // Replay guard: if this recall has already been answered, return the
  // existing feedback row without inserting a duplicate or re-alerting.
  if (recall.feedbackAt) {
    const existing = await findExistingPrivateFeedback(recall.recallId);
    if (existing) {
      return { ok: true, feedbackId: existing, replayed: true };
    }
    // Shouldn't happen — feedback_at set without a row — fall through to
    // insert path; the unique index will surface any conflict.
  }

  // Insert with ON CONFLICT DO NOTHING targeting the partial unique index
  // from migration 0032. Race-safe: if a concurrent POST won the insert,
  // ours returns no row and we look up the winner's id.
  const [inserted] = await db
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
      source: "private",
    })
    .onConflictDoNothing()
    .returning({ id: schema.patientFeedback.id });

  if (!inserted) {
    const existing = await findExistingPrivateFeedback(recall.recallId);
    if (existing) {
      return { ok: true, feedbackId: existing, replayed: true };
    }
    // Conflict but no row found — concurrent delete? Treat as not_found.
    return { ok: false, reason: "not_found" };
  }

  // First successful submission. Update the recall — note: ratingValue uses
  // COALESCE so the *first* recorded rating wins (matches recordRatingClick
  // semantics + closes the H-19 "replay overwrites rating" bug even though
  // the replay path now short-circuits before this point).
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    UPDATE request_recalls
       SET feedback_at  = now(),
           status       = 'completed',
           rating_value = COALESCE(rating_value, ${submission.rating})
     WHERE id = ${recall.recallId}
  `);

  // Alert the Praxis. Best-effort — failure must not break the patient flow.
  try {
    const inbox = recall.reviewInboxEmail ?? recall.defaultDoctorEmail;
    if (inbox) {
      const rendered = renderFeedbackAlertEmail({
        clinicName: recall.clinicName,
        portalOrigin: env.APP_ORIGIN,
        feedbackId: inserted.id,
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
        clinicId: recall.clinicId,
        klass: "transactional",
      });
    } else {
      console.warn(
        `[review-tokens] no inbox configured for clinic=${recall.clinicId}, feedback ${inserted.id} not alerted`
      );
    }
  } catch (err) {
    console.error("[review-tokens] alert enqueue failed:", err);
  }

  return { ok: true, feedbackId: inserted.id, replayed: false };
}

async function findExistingPrivateFeedback(
  recallId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.patientFeedback.id })
    .from(schema.patientFeedback)
    .where(
      and(
        eq(schema.patientFeedback.recallId, recallId),
        eq(schema.patientFeedback.source, "private")
      )
    )
    .orderBy(desc(schema.patientFeedback.createdAt))
    .limit(1);
  return row?.id ?? null;
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
