import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Email suppression — central check for outbound sends.
 *
 * Suppression reasons:
 *   • `unsubscribed` — patient hit /r/unsubscribe or a PMS unsubscribed
 *     event. Marketing-class sends are blocked. Transactional sends
 *     (magic-link, password reset, urgent alert) still go through.
 *   • `bounced`     — Resend webhook reported a hard bounce. Inbox is
 *     dead. Block ALL sends — including transactional — because they
 *     can't be delivered anyway and accumulating bounces costs us
 *     reputation.
 *   • `complained`  — Resend webhook reported a spam complaint. Treat
 *     identically to bounced: deliverability is poisoned.
 *   • `manual`      — admin manually suppressed. Block all classes.
 *
 * The class parameter controls which reasons block:
 *   • `transactional`  — only hard signals (bounced, complained, manual)
 *   • `marketing`      — every reason
 */

export type SuppressionClass = "transactional" | "marketing";

/**
 * Returns the reason this address is suppressed for the given class, or
 * null if it may be sent to.
 */
export async function isEmailSuppressed(
  clinicId: string,
  email: string,
  klass: SuppressionClass
): Promise<string | null> {
  const lower = email.trim().toLowerCase();
  if (!lower) return null;
  const [row] = await db
    .select({ reason: schema.emailSuppression.reason })
    .from(schema.emailSuppression)
    .where(
      and(
        eq(schema.emailSuppression.clinicId, clinicId),
        eq(schema.emailSuppression.email, lower)
      )
    )
    .limit(1);
  if (!row) return null;
  if (klass === "transactional") {
    return row.reason === "unsubscribed" ? null : row.reason;
  }
  return row.reason;
}
