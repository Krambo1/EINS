import { getEmailSender, buildBrandedEmailHtml } from "@/server/email";
import { isEmailSuppressed } from "@/server/email-suppression";

export interface EmailSendJob {
  to: string;
  subject: string;
  text: string;
  /** Optional — plaintext is wrapped in a branded fallback if omitted. */
  html?: string;
  /**
   * Optional clinic the email belongs to. When set, the worker checks
   * `email_suppression` first and silently drops sends that match
   * (the audit-side bookkeeping happens at suppression-write time, not
   * per skipped send — those would be too noisy).
   */
  clinicId?: string | null;
  /**
   * Send class. Defaults to 'transactional' so legacy callers that don't
   * pass it keep their old behavior (only hard signals block them).
   * 'marketing' is honored only when explicitly passed.
   */
  klass?: "transactional" | "marketing";
  /**
   * Optional patient/recipient token used to build the
   * `List-Unsubscribe`/`List-Unsubscribe-Post` headers (RFC 8058). Set by
   * review-request sends — keeps Gmail's "Mark as spam" 1-click flow
   * working and protects deliverability.
   */
  unsubscribeUrl?: string | null;
}

/**
 * Async email send. Same shape as `enqueueEmail`. Failures bubble so BullMQ
 * retries (exponential backoff).
 *
 * Order of operations:
 *   1. Suppression check (silent drop if matched).
 *   2. Render HTML — either the caller-supplied body or a branded wrapper
 *      around the plaintext. Bare `<pre>` no longer ships; spam filters
 *      score that down hard.
 *   3. Forward to the configured driver with List-Unsubscribe headers
 *      attached when an unsubscribe URL is available.
 */
export async function processEmailSend(job: EmailSendJob): Promise<void> {
  if (job.clinicId) {
    const klass = job.klass ?? "transactional";
    const reason = await isEmailSuppressed(job.clinicId, job.to, klass);
    if (reason) {
      console.log(
        `[email-send] skipping to=${job.to} clinic=${job.clinicId} reason=${reason}`
      );
      return;
    }
  }

  await getEmailSender().send({
    to: job.to,
    subject: job.subject,
    text: job.text,
    html: job.html ?? buildBrandedEmailHtml(job.text),
    unsubscribeUrl: job.unsubscribeUrl ?? null,
  });
}
