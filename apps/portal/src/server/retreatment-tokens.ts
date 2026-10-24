import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { escapeHtml } from "@/server/email";
import { unsubscribePatient } from "@/server/patient-events";
import { isValidTokenShape } from "@/server/review-tokens";

/**
 * Wiederbehandlungs-Kalender: token-as-auth helpers for the two public links
 * in the reminder email (booking redirect, unsubscribe). Same model as the
 * review tokens: 64 hex chars, no session, superuser `db` because the
 * patient has no clinic context (the token IS the scope).
 */

export { isValidTokenShape };

export interface ResolvedRetreatmentToken {
  id: string;
  clinicId: string;
  patientId: string;
  requestId: string | null;
  clinicName: string;
  bookingUrl: string | null;
  phone: string | null;
  reminderEmail: string | null;
}

export async function resolveRetreatmentToken(
  token: string
): Promise<ResolvedRetreatmentToken | null> {
  if (!isValidTokenShape(token)) return null;
  const t = schema.retreatmentCycles;
  const [row] = await db
    .select({
      id: t.id,
      clinicId: t.clinicId,
      patientId: t.patientId,
      requestId: t.requestId,
      clinicName: schema.clinics.displayName,
      bookingUrl: schema.clinics.retreatmentBookingUrl,
      phone: schema.clinics.retreatmentPhone,
      reminderEmail: t.reminderEmail,
    })
    .from(t)
    .innerJoin(schema.clinics, eq(t.clinicId, schema.clinics.id))
    .where(eq(t.token, token.toLowerCase()))
    .limit(1);
  return row ?? null;
}

/** First click wins; later clicks keep the original timestamp. */
export async function recordBookingClick(id: string): Promise<void> {
  const t = schema.retreatmentCycles;
  await db
    .update(t)
    .set({ bookingClickedAt: new Date() })
    .where(and(eq(t.id, id), isNull(t.bookingClickedAt)));
}

/** Only http(s) targets; anything else (javascript:, data:) is refused. */
export function safeBookingTarget(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Suppress the address the reminder went to (falls back to the patient row
 * for a row that was never sent). Reason 'unsubscribed' blocks marketing
 * mail only, so appointment confirmations from the Praxis still arrive.
 */
export async function unsubscribeRetreatmentToken(
  resolved: ResolvedRetreatmentToken
): Promise<boolean> {
  let email = resolved.reminderEmail;
  if (!email) {
    const [pat] = await db
      .select({ email: schema.patients.email })
      .from(schema.patients)
      .where(
        and(eq(schema.patients.id, resolved.patientId), eq(schema.patients.clinicId, resolved.clinicId))
      )
      .limit(1);
    email = pat?.email ?? null;
  }
  if (!email) return false;
  await unsubscribePatient(resolved.clinicId, email, "unsubscribed");
  return true;
}

/** Minimal standalone page for the patient (no portal chrome, no tracking). */
export function patientPage(opts: {
  title: string;
  heading: string;
  body: string[];
  /** Renders a single POST button to the current URL. */
  confirmLabel?: string;
}): string {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${e(opts.title)}</title></head>
<body style="margin:0; background:#f2f2f4; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; color:#10101a;">
  <main style="max-width:520px; margin:48px auto; padding:0 16px;">
    <div style="background:#ffffff; border:1px solid #e4e4e7; border-radius:16px; padding:32px;">
      <h1 style="font-size:22px; font-weight:600; margin:0 0 16px 0;">${e(opts.heading)}</h1>
      ${opts.body.map((b) => `<p style="font-size:16px; line-height:1.55; margin:0 0 12px 0;">${e(b)}</p>`).join("")}
      ${
        opts.confirmLabel
          ? `<form method="post" style="margin-top:20px;"><button type="submit" style="font-size:16px; font-weight:600; padding:12px 20px; border-radius:12px; border:0; background:#10101a; color:#ffffff; cursor:pointer;">${e(opts.confirmLabel)}</button></form>`
          : ""
      }
    </div>
  </main>
</body></html>`;
}
