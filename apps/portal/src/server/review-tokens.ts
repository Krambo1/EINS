import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { unsubscribePatient } from "@/server/patient-events";
import { enqueueEmail } from "@/server/jobs";
import { sendEmailOnce } from "@/server/email-once";
import { env } from "@/lib/env";
import { renderFeedbackAlertEmail } from "@/server/email/templates/feedback-alert";

/**
 * EINS Bewertungen — server-side functions backing /api/review-tokens/[token]/*.
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

type ReviewRequestWithClinic = {
  reviewRequestId: string;
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
  token: string,
  opts: { allowExpired?: boolean } = {}
): Promise<ReviewRequestWithClinic | null> {
  if (!isValidTokenShape(token)) return null;

  const [row] = await db
    .select({
      reviewRequestId: schema.reviewEmailSchedule.id,
      clinicId: schema.clinics.id,
      clinicName: schema.clinics.displayName,
      googleReviewUrl: schema.clinics.googleReviewUrl,
      googlePlaceId: schema.clinics.googlePlaceId,
      jamedaReviewUrl: schema.clinics.jamedaReviewUrl,
      reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
      reviewInboxEmail: schema.clinics.reviewInboxEmail,
      defaultDoctorEmail: schema.clinics.defaultDoctorEmail,
      patientId: schema.reviewEmailSchedule.patientId,
      patientName: schema.reviewEmailSchedule.reviewPatientName,
      patientEmail: schema.reviewEmailSchedule.reviewEmail,
      ratingValue: schema.reviewEmailSchedule.ratingValue,
      ratingClickedAt: schema.reviewEmailSchedule.ratingClickedAt,
      publicClickedAt: schema.reviewEmailSchedule.publicClickedAt,
      feedbackAt: schema.reviewEmailSchedule.feedbackAt,
      expiresAt: schema.reviewEmailSchedule.reviewTokenExpiresAt,
    })
    .from(schema.reviewEmailSchedule)
    .innerJoin(
      schema.clinics,
      eq(schema.reviewEmailSchedule.clinicId, schema.clinics.id)
    )
    .where(eq(schema.reviewEmailSchedule.reviewToken, token))
    .limit(1);
  if (!row) return null;
  // Hard expiry check. NULL expiresAt means a legacy row that pre-dates
  // migration 0035 — the migration backfills, but defend in code anyway
  // so a missed migration in dev doesn't silently re-open the leak window.
  // `allowExpired` is for unsubscribe only (E-18): an opt-out must keep
  // working after the 90-day rating window, otherwise an old link fails and
  // the next mail still goes out (§ 7 UWG).
  if (!opts.allowExpired && (!row.expiresAt || row.expiresAt < new Date())) {
    return null;
  }
  // Strip expiresAt from the public shape: callers do not need it.
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
 * Record a 1..5 rating click from the landing page. The LATEST click wins
 * until the patient submits private feedback (E-31): mail scanners that open
 * all five star links in order used to pin the first one (1 ★) as the
 * patient's rating forever. After feedback, the submitted rating is final.
 * Also refreshes `rating_clicked_at`. Implemented as a single SQL statement so the two
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
    UPDATE review_email_schedule
       SET rating_clicked_at = now(),
           rating_value      = CASE WHEN feedback_at IS NULL THEN ${rating} ELSE rating_value END
     WHERE review_token = ${token}
       AND kind         = 'review_request'
  `);
  return { ok: true };
}

/**
 * Record that the patient clicked the public review CTA. Touches the
 * review-request row but does NOT change status — the patient may still
 * come back and submit private feedback. Status flips to 'completed' only
 * when private feedback is submitted, mirroring the same end-state.
 *
 * Also persists a `patient_feedback` row with source='public_redirect' so
 * the Praxis sees every rating that engaged with the request in one inbox,
 * not just the private ones. Idempotent per review-request: if the patient
 * clicks Google and later comes back and clicks Jameda, the existing row
 * is updated in place (one row per request, last platform wins). No alert
 * email is fired — public clicks are positive-leaning signals and the
 * sync workers will pick up the actual Google/Jameda review separately.
 */
export async function recordPublicClick(
  token: string,
  platform: "google" | "jameda"
): Promise<{ ok: boolean }> {
  if (!isValidTokenShape(token)) return { ok: false };

  const reviewRequest = await resolveReviewToken(token);
  if (!reviewRequest) return { ok: false };

  await db
    .update(schema.reviewEmailSchedule)
    .set({
      publicClickedAt: new Date(),
      publicClickedPlatform: platform,
    })
    .where(eq(schema.reviewEmailSchedule.id, reviewRequest.reviewRequestId));

  // Persist the public-redirect feedback row. We need a rating to satisfy
  // patient_feedback.rating NOT NULL — if for some reason the patient hit
  // /go without ever recording a rating, skip the inbox entry rather than
  // invent one.
  if (reviewRequest.ratingValue !== null) {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`
      INSERT INTO patient_feedback (
        clinic_id,
        patient_id,
        review_request_id,
        rating,
        contact_email,
        contact_name,
        source,
        public_platform
      ) VALUES (
        ${reviewRequest.clinicId},
        ${reviewRequest.patientId},
        ${reviewRequest.reviewRequestId},
        ${reviewRequest.ratingValue},
        ${reviewRequest.patientEmail},
        ${reviewRequest.patientName},
        'public_redirect',
        ${platform}
      )
      ON CONFLICT (review_request_id) WHERE source = 'public_redirect'
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
 * Idempotency: at most one private feedback row per review-request. A
 * second POST with a valid token short-circuits to the existing row
 * (replayed=true) and does NOT fire a duplicate alert email. The migration
 * 0032 partial unique index closes the race window where two concurrent
 * POSTs slip past the application-side check.
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

  const reviewRequest = await resolveReviewToken(token);
  if (!reviewRequest) return { ok: false, reason: "not_found" };

  // Suppression gate: an unsubscribed patient may not submit feedback.
  // We check both per-clinic email_suppression (the canonical store) and
  // reviewRequest.patientEmail because the email lives only on the
  // review-request row when the patient came in via a non-PMS flow.
  const suppressionEmail =
    reviewRequest.patientEmail?.trim().toLowerCase() ?? null;
  if (suppressionEmail) {
    const [suppressed] = await db
      .select({ id: schema.emailSuppression.id })
      .from(schema.emailSuppression)
      .where(
        and(
          eq(schema.emailSuppression.clinicId, reviewRequest.clinicId),
          eq(schema.emailSuppression.email, suppressionEmail)
        )
      )
      .limit(1);
    if (suppressed) {
      return { ok: false, reason: "unsubscribed" };
    }
  }

  // Replay guard: if this review-request has already been answered, return
  // the existing feedback row without inserting a duplicate or re-alerting.
  if (reviewRequest.feedbackAt) {
    const existing = await findExistingPrivateFeedback(
      reviewRequest.reviewRequestId
    );
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
      clinicId: reviewRequest.clinicId,
      patientId: reviewRequest.patientId,
      reviewRequestId: reviewRequest.reviewRequestId,
      rating: submission.rating,
      freeText: submission.freeText?.slice(0, 5000) ?? null,
      contactBackOk: submission.contactBackOk,
      contactEmail:
        submission.contactEmail ?? reviewRequest.patientEmail ?? null,
      contactName: submission.contactName ?? reviewRequest.patientName ?? null,
      source: "private",
    })
    .onConflictDoNothing()
    .returning({ id: schema.patientFeedback.id });

  if (!inserted) {
    const existing = await findExistingPrivateFeedback(
      reviewRequest.reviewRequestId
    );
    if (existing) {
      return { ok: true, feedbackId: existing, replayed: true };
    }
    // Conflict but no row found — concurrent delete? Treat as not_found.
    return { ok: false, reason: "not_found" };
  }

  // First successful submission. The submitted rating is a deliberate act and
  // overrides any landing-page click (E-31). Replays never reach this point
  // (they short-circuit above, H-19), so it cannot overwrite a later value
  // (the replay guard above is what closes H-19; no COALESCE needed here
  // point).
  const { sql } = await import("drizzle-orm");
  await db.execute(sql`
    UPDATE review_email_schedule
       SET feedback_at  = now(),
           status       = 'completed',
           rating_value = ${submission.rating}
     WHERE id = ${reviewRequest.reviewRequestId}
  `);

  // In-app bell for the Inhaber:innen (E-30), independent of mail delivery.
  // No patient data in the text; the link leads behind the login.
  try {
    const owners = await db
      .select({ id: schema.clinicUsers.id })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, reviewRequest.clinicId),
          eq(schema.clinicUsers.role, "inhaber"),
          isNull(schema.clinicUsers.archivedAt)
        )
      );
    if (owners.length > 0) {
      await db.insert(schema.notifications).values(
        owners.map((u) => ({
          userId: u.id,
          clinicId: reviewRequest.clinicId,
          kind: "patient_feedback",
          title: `Neue Patienten-Rückmeldung (${submission.rating} ★)`,
          body: submission.contactBackOk
            ? "Rückruf gewünscht. Details im Portal."
            : "Details im Portal.",
          link: `/bewertungen/feedback/${inserted.id}`,
        }))
      );
    }
  } catch (err) {
    console.error("[review-tokens] feedback notification failed:", err);
  }

  // Alert the Praxis. Best-effort — failure must not break the patient flow.
  try {
    const inbox =
      reviewRequest.reviewInboxEmail ?? reviewRequest.defaultDoctorEmail;
    if (inbox) {
      const rendered = renderFeedbackAlertEmail({
        clinicName: reviewRequest.clinicName,
        portalOrigin: env.APP_ORIGIN,
        feedbackId: inserted.id,
        rating: submission.rating,
        freeText: submission.freeText ?? null,
        patientName:
          submission.contactName ?? reviewRequest.patientName ?? null,
        patientEmail:
          submission.contactEmail ?? reviewRequest.patientEmail ?? null,
        contactBackOk: submission.contactBackOk,
      });
      // Inline send (E-30): this alarm is the Praxis's only signal about a
      // negative patient experience and must not wait for the worker. The
      // ledger key makes a replay/second path a no-op.
      const mail = {
        to: inbox,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        clinicId: reviewRequest.clinicId,
        klass: "transactional" as const,
      };
      try {
        await sendEmailOnce({ ...mail, key: `feedback-alert/${inserted.id}` });
      } catch (sendErr) {
        console.error(
          `[review-tokens] inline alert failed feedback=${inserted.id}, queued as fallback:`,
          sendErr instanceof Error ? sendErr.message : sendErr
        );
        // Retry net for when the worker runs; the key keeps Resend from
        // delivering twice if the inline attempt actually went through.
        const queued = { ...mail, idempotencyKey: `feedback-alert/${inserted.id}` };
        await enqueueEmail(queued);
      }
    } else {
      console.warn(
        `[review-tokens] no inbox configured for clinic=${reviewRequest.clinicId}, feedback ${inserted.id} not alerted`
      );
    }
  } catch (err) {
    console.error("[review-tokens] alert enqueue failed:", err);
  }

  return { ok: true, feedbackId: inserted.id, replayed: false };
}

async function findExistingPrivateFeedback(
  reviewRequestId: string
): Promise<string | null> {
  const [row] = await db
    .select({ id: schema.patientFeedback.id })
    .from(schema.patientFeedback)
    .where(
      and(
        eq(schema.patientFeedback.reviewRequestId, reviewRequestId),
        eq(schema.patientFeedback.source, "private")
      )
    )
    .orderBy(desc(schema.patientFeedback.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Unsubscribe the patient whose review-request this token belongs to. Adds
 * an email_suppression row and tombstones the patient.
 */
export async function unsubscribeViaToken(
  token: string
): Promise<{ ok: boolean; clinicName?: string }> {
  if (!isValidTokenShape(token)) return { ok: false };
  const reviewRequest = await resolveReviewToken(token, { allowExpired: true });
  if (!reviewRequest || !reviewRequest.patientEmail) return { ok: false };
  await unsubscribePatient(
    reviewRequest.clinicId,
    reviewRequest.patientEmail,
    "unsubscribed"
  );
  return { ok: true, clinicName: reviewRequest.clinicName };
}
