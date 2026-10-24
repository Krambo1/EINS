/**
 * Classify a Resend webhook event into a suppression reason (E-06).
 *
 * Resend's bounce payload mirrors Amazon SES: `data.bounce.type` is
 * "Permanent" | "Transient" | "Undetermined" (capitalized) with a `subType`
 * such as "General" or "Suppressed". The old check compared against
 * lowercase "permanent" and therefore never suppressed anything.
 *
 * Resend only emits `email.bounced` for a permanent rejection (temporary
 * problems arrive as `email.delivery_delayed`), so a bounce counts as hard
 * unless the payload explicitly says transient. Case-insensitive throughout.
 */

export interface ResendWebhookEvent {
  type?: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: {
      type?: string;
      subType?: string;
      message?: string;
    };
  };
}

export type SuppressionReason = "bounced" | "complained";

export function suppressionReasonFor(event: ResendWebhookEvent): SuppressionReason | null {
  const type = String(event.type ?? "").toLowerCase();
  if (type === "email.complained") return "complained";
  if (type === "email.bounced") {
    const bounceType = String(event.data?.bounce?.type ?? "").toLowerCase();
    if (bounceType === "transient") return null;
    return "bounced";
  }
  return null;
}

/** Normalized recipient list; Resend sends `to` as an array, tolerate a string. */
export function recipientsOf(event: ResendWebhookEvent): string[] {
  const to = event.data?.to;
  const list = Array.isArray(to) ? to : typeof to === "string" ? [to] : [];
  return list
    .map((s) => {
      const m = s.match(/<([^>]+)>/);
      return (m ? m[1]! : s).trim().toLowerCase();
    })
    .filter((s) => s.includes("@"));
}
