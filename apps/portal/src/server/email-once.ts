import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { getEmailSender, buildBrandedEmailHtml, type SendEmailInput } from "@/server/email";
import { isEmailSuppressed, type SuppressionClass } from "@/server/email-suppression";
import { describeErrorForLog } from "@/lib/error-log";

/**
 * Send an automated email at most once per `key`, without the pg-boss worker.
 *
 * Used by the daily Vercel cron (monthly report, review requests) and by
 * request-path triggers that must not wait for a queue (animation ready,
 * negative-feedback alarm). Safe when the Fly worker runs the same processor
 * later: the ledger row (migration 0083) makes the second run a no-op.
 *
 *   1. suppression check (when clinicId is given)
 *   2. claim the key in email_send_log: insert it, or take over a claim that
 *      is older than CLAIM_STALE_MINUTES and was never delivered (the
 *      function died between claim and send). Atomic: of two concurrent
 *      claimers exactly one gets the row back.
 *   3. send, with the key as Resend Idempotency-Key (identical on every
 *      retry, so Resend drops a second copy within its 24 h window)
 *   4. success: set delivered_at (migration 0094). Failure: release the claim
 *      and rethrow, so the next run retries.
 * `sent_at` is the claim time; `delivered_at` NULL means "not confirmed".
 */

/** A claim without delivery older than this may be taken again. */
export const CLAIM_STALE_MINUTES = 15;

export type SendOnceResult = "sent" | "duplicate" | "suppressed";

export interface SendOnceInput extends Omit<SendEmailInput, "html" | "idempotencyKey"> {
  /** Stable key for this logical mail, e.g. `monthly-report/<clinic>/<period>/<email>`. */
  key: string;
  /** Clinic on whose behalf the mail goes out; null = ops/cross-tenant mail. */
  clinicId: string | null;
  klass?: SuppressionClass;
  /** Optional; the plaintext is wrapped in the branded layout when omitted. */
  html?: string;
}

export async function sendEmailOnce(input: SendOnceInput): Promise<SendOnceResult> {
  const { key, clinicId, klass = "transactional", html, ...mail } = input;

  if (clinicId) {
    const reason = await isEmailSuppressed(clinicId, mail.to, klass);
    if (reason) return "suppressed";
  }

  const claimed = (await db.execute(sql`
    INSERT INTO email_send_log (idempotency_key, clinic_id)
    VALUES (${key}, ${clinicId})
    ON CONFLICT (idempotency_key) DO UPDATE SET sent_at = now()
      WHERE email_send_log.delivered_at IS NULL
        AND email_send_log.sent_at < now() - (${CLAIM_STALE_MINUTES}::int * interval '1 minute')
    RETURNING idempotency_key
  `)) as unknown as unknown[];
  if (claimed.length === 0) return "duplicate";

  try {
    await getEmailSender().send({
      ...mail,
      html: html ?? buildBrandedEmailHtml(mail.text),
      idempotencyKey: key,
    });
  } catch (err) {
    await db
      .execute(
        sql`DELETE FROM email_send_log WHERE idempotency_key = ${key} AND delivered_at IS NULL`
      )
      .catch(() => undefined);
    throw err;
  }
  // The provider accepted the mail. If this bookkeeping write fails, the
  // claim goes stale and a later run re-sends with the same Idempotency-Key,
  // which Resend drops within 24 h; so log, never throw.
  await db
    .execute(sql`UPDATE email_send_log SET delivered_at = now() WHERE idempotency_key = ${key}`)
    .catch((err: unknown) => {
      console.error(
        `[email-once] delivered mark failed key=${key.split("/")[0]}:`,
        JSON.stringify(describeErrorForLog(err))
      );
    });
  return "sent";
}
