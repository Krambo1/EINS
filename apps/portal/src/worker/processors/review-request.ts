import { and, eq, isNotNull, isNull, lt, lte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { renderReviewRequestEmail } from "@/server/email/templates/review-request";
import { bareAddress } from "@/server/email";
import { sendEmailOnce } from "@/server/email-once";
import { env } from "@/lib/env";
import { describeErrorForLog } from "@/lib/error-log";
import { normalizeAllowedLandingOrigin } from "@/lib/review-url-allowlist";
import { addDaysIso, berlinToday, isPatientMailWindow } from "./berlin-days";

/**
 * EINS Bewertungen — review-request scanner.
 *
 * Runs from the daily Vercel cron (/api/cron/morning) and, when the Fly
 * worker is on, every 15 min via pg-boss. Selects due review-request rows
 * that are still pending and sends each mail directly (no queue hop).
 *
 * Idempotency: each row is claimed with an atomic pending -> sent UPDATE
 * before sending; a failed send rolls it back to pending. The email_send_log
 * ledger (key review-request/<rowId>) plus the Resend Idempotency-Key make a
 * second delivery impossible even if two runners overlap.
 *
 * Suppression check runs in-tick: a clinic admin may add an entry to
 * email_suppression between the row being scheduled and the send tick.
 */
export type ReviewRequestTickJob = Record<string, never>;

const BATCH_LIMIT = 200;
/** Rows older than this are never sent (E-11): a review ask weeks after the
 *  visit reads as spam. They are marked skipped/stale instead. */
export const REVIEW_MAX_AGE_DAYS = 14;

export interface ReviewTickResult {
  sent: number;
  skipped: number;
  failed: number;
  stale: number;
  outsideWindow: boolean;
}

export async function processReviewRequestTick(): Promise<void> {
  await runReviewRequestTick();
}

/**
 * Sends due review mails directly (no pg-boss hop, E-08): works from the
 * Vercel cron and from the worker alike. Only inside the patient mail window
 * (Mon-Fri 09-18 Berlin, E-12); outside it everything stays pending.
 */
export async function runReviewRequestTick(
  now: Date = new Date()
): Promise<ReviewTickResult> {
  const result: ReviewTickResult = { sent: 0, skipped: 0, failed: 0, stale: 0, outsideWindow: false };
  if (!isPatientMailWindow(now)) {
    result.outsideWindow = true;
    return result;
  }
  // Berlin calendar day, not UTC (E-12).
  const today = berlinToday(now);
  const oldest = addDaysIso(today, -REVIEW_MAX_AGE_DAYS);

  const staleRows = await db
    .update(schema.reviewEmailSchedule)
    .set({ status: "skipped", note: "stale" })
    .where(
      and(
        eq(schema.reviewEmailSchedule.kind, "review_request"),
        eq(schema.reviewEmailSchedule.status, "pending"),
        lt(schema.reviewEmailSchedule.scheduledFor, oldest)
      )
    )
    .returning({ id: schema.reviewEmailSchedule.id });
  result.stale = staleRows.length;

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
    reviewInboxEmail: string | null;
    defaultDoctorEmail: string | null;
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
      reviewInboxEmail: schema.clinics.reviewInboxEmail,
      defaultDoctorEmail: schema.clinics.defaultDoctorEmail,
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
        isNotNull(schema.reviewEmailSchedule.reviewEmail),
        // Archived Praxis (contract ended): no more patient mails. Pending
        // rows stay pending and are erased with the Praxis (INT-A A5 b).
        isNull(schema.clinics.archivedAt)
      )
    )
    .limit(BATCH_LIMIT)) as DueRow[];

  if (due.length === 0) {
    console.log("[review-request] tick: nothing due");
    return result;
  }

  console.log(`[review-request] tick: ${due.length} due rows`);

  for (const row of due) {
    try {
      const outcome = await sendOne(row);
      if (outcome === "sent") result.sent++;
      else result.skipped++;
    } catch (err) {
      result.failed++;
      // Resend errors can echo the recipient address: log a scrubbed form (L-8).
      console.error(
        `[review-request] send failed reviewRequestId=${row.reviewRequestId}:`,
        JSON.stringify(describeErrorForLog(err))
      );
      // Roll back to 'pending' so the next tick retries. Without the rollback
      // the row would stay 'sent' with no email actually delivered.
      await db
        .update(schema.reviewEmailSchedule)
        .set({ status: "pending" })
        .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    }
  }
  return result;
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
  reviewInboxEmail: string | null;
  defaultDoctorEmail: string | null;
  reviewRequestEnabled: boolean;
}): Promise<"sent" | "skipped"> {
  // Re-check feature flag — admin may have flipped it off after scheduling.
  if (!row.reviewRequestEnabled) {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "feature_disabled" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return "skipped";
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
    return "skipped";
  }

  // Refuse to send if the clinic hasn't configured at least one public review URL.
  // Without it the landing page would render an empty CTA. Better to skip
  // than to email a patient and dead-end them.
  if (!row.googleReviewUrl && !row.jamedaReviewUrl) {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "no_review_url" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return "skipped";
  }

  // Pick the landing origin — clinic-specific if configured, otherwise the
  // global CLINIC_LANDING_ORIGIN default so dev still works without admin setup.
  // J-4: a stored origin outside the allowlist (saved before the check
  // existed) falls back to the EINS default, like the unsubscribe GET.
  const landingOrigin =
    (row.reviewLandingOrigin
      ? normalizeAllowedLandingOrigin(row.reviewLandingOrigin, env.CLINIC_LANDING_ORIGIN, env.CLINIC_LANDING_ORIGINS)
      : null) ?? env.CLINIC_LANDING_ORIGIN;

  // The renderer accepts richer context (appointmentDate, practiceSpecialty,
  // practiceLocation, practitionerName) than we currently persist on
  // review_email_schedule. Pass null for those — the template degrades
  // gracefully (drops the lockup sub-line, drops the visit-card cells,
  // drops the date in the body intro / footer reminder). Future schema work
  // would:
  //   1. add reviewVisitDate to review_email_schedule (persist
  //      patient_event.appointmentCompletedAt) — easy win
  //   2. add specialty / locationLabel columns on clinics — config UI
  //   3. extend the PVS canonical event to carry practitionerName onto
  //      review_email_schedule
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

  // Atomic claim: only the runner that flips pending -> sent sends. Two
  // runners (Vercel cron and the worker) can never both mail this row.
  const claimed = await db
    .update(schema.reviewEmailSchedule)
    .set({ status: "sent", sentAt: new Date() })
    .where(
      and(
        eq(schema.reviewEmailSchedule.id, row.reviewRequestId),
        eq(schema.reviewEmailSchedule.status, "pending")
      )
    )
    .returning({ id: schema.reviewEmailSchedule.id });
  if (claimed.length === 0) return "skipped";

  // RFC 8058 one-click target: the portal API accepts POST (Gmail/Yahoo)
  // and redirects a plain GET to the confirmation page (E-18, B-22). The
  // visible footer link in the body still points at the landing page.
  const unsubscribeUrl = `${env.APP_ORIGIN.replace(/\/$/, "")}/api/review-tokens/${encodeURIComponent(row.reviewToken)}/unsubscribe`;

  // Send directly (E-08): a failed send throws, the caller rolls the row
  // back to pending, and the next tick retries. The ledger key prevents a
  // second delivery if the worker and the cron overlap.
  const outcome = await sendEmailOnce({
    key: `review-request/${row.reviewRequestId}`,
    clinicId: row.clinicId,
    klass: "marketing",
    to: row.reviewEmail,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    unsubscribeUrl,
    // E-13: the Praxis is the visible sender; replies go to the Praxis inbox.
    from: reviewFrom(row.clinicDisplayName, row.reviewEmailFrom),
    replyTo: row.reviewInboxEmail ?? row.defaultDoctorEmail ?? null,
  });
  if (outcome === "suppressed") {
    await db
      .update(schema.reviewEmailSchedule)
      .set({ status: "skipped", note: "suppressed" })
      .where(eq(schema.reviewEmailSchedule.id, row.reviewRequestId));
    return "skipped";
  }
  return "sent";
}

/**
 * From header for patient review mail. A per-Praxis `review_email_from`
 * (admin-set, must be a Resend-verified domain) wins; otherwise the Praxis
 * name as display name on the EINS address: `"Praxis X via EINS" <team@eins.ag>`.
 */
export function reviewFrom(clinicName: string, override: string | null): string {
  if (override && override.trim()) return override.trim();
  const display = `${clinicName} via EINS`.replace(/["<>\r\n\\]/g, "").trim();
  return `"${display}" <${bareAddress(env.EMAIL_FROM)}>`;
}
