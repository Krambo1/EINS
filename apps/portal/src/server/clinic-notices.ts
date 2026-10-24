import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { buildBrandedEmailHtml, getEmailSender } from "@/server/email";
import { isEmailSuppressed } from "@/server/email-suppression";

/**
 * Formal notices EINS sends a Praxis from the admin (H-03): Verzug,
 * Rückruf-Warnung, Anzeigen-Pause, Fortsetzung. Sent directly (no worker) to
 * every active Inhaber plus the Praxis' default e-mail, and stored with the
 * exact text in `clinic_notices` (migration 0086, raw SQL, no Drizzle mirror)
 * so a dispute can be answered with what was actually sent and when.
 */

/** "stoerung": Plattform-Störung (K-7 Teil 2, migration 0092). */
export type NoticeKind =
  | "verzug"
  | "warnung_rueckruf"
  | "pause"
  | "fortsetzung"
  | "fristende"
  | "stoerung";

export interface NoticeRow {
  id: string;
  kind: NoticeKind;
  recipients: string[];
  failedRecipients: string[];
  subject: string;
  bodyText: string;
  sentAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

/** Owners (active) + defaultDoctorEmail, de-duplicated, lowercase. */
export async function noticeRecipients(clinicId: string): Promise<string[]> {
  const [owners, [clinic]] = await Promise.all([
    db
      .select({ email: schema.clinicUsers.email })
      .from(schema.clinicUsers)
      .where(
        and(
          eq(schema.clinicUsers.clinicId, clinicId),
          eq(schema.clinicUsers.role, "inhaber"),
          isNull(schema.clinicUsers.archivedAt)
        )
      ),
    db
      .select({ email: schema.clinics.defaultDoctorEmail })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1),
  ]);
  const set = new Set<string>();
  for (const o of owners) set.add(o.email.toLowerCase());
  if (clinic?.email) set.add(clinic.email.toLowerCase());
  return [...set];
}

/**
 * Send and store one notice. Returns the stored row; `sentAt` is null when
 * no recipient could be reached (no address, all suppressed or all failed).
 */
export async function sendClinicNotice(input: {
  clinicId: string;
  kind: NoticeKind;
  subject: string;
  body: string;
  createdBy: string;
}): Promise<NoticeRow> {
  const candidates = await noticeRecipients(input.clinicId);
  const sender = getEmailSender();
  const html = buildBrandedEmailHtml(input.body);
  const delivered: string[] = [];
  const failed: string[] = [];
  let lastError: string | null = null;

  for (const to of candidates) {
    if (await isEmailSuppressed(input.clinicId, to, "transactional")) {
      failed.push(to);
      lastError = "unterdrückt (Bounce oder Beschwerde)";
      continue;
    }
    try {
      await sender.send({ to, subject: input.subject, text: input.body, html });
      delivered.push(to);
    } catch (err) {
      failed.push(to);
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`[clinic-notice] send failed clinic=${input.clinicId} kind=${input.kind}:`, lastError);
    }
  }
  if (candidates.length === 0) lastError = "keine Empfängeradresse (kein Inhaber-Zugang, keine Standard-E-Mail)";

  const sentAt = delivered.length > 0 ? new Date() : null;
  const rows = (await db.execute(sql`
    INSERT INTO clinic_notices
      (clinic_id, kind, recipients, failed_recipients, subject, body_text, sent_at, send_error, created_by)
    VALUES (
      ${input.clinicId}, ${input.kind},
      ${sql.raw(pgTextArray(delivered))}, ${sql.raw(pgTextArray(failed))},
      ${input.subject}, ${input.body}, ${sentAt ? sentAt.toISOString() : null}::timestamptz, ${lastError}, ${input.createdBy}
    )
    RETURNING id, created_at
  `)) as unknown as Array<{ id: string; created_at: Date }>;

  return {
    id: rows[0]!.id,
    kind: input.kind,
    recipients: delivered,
    failedRecipients: failed,
    subject: input.subject,
    bodyText: input.body,
    sentAt,
    createdBy: input.createdBy,
    createdAt: new Date(rows[0]!.created_at),
  };
}

export async function listClinicNotices(clinicId: string, limit = 20): Promise<NoticeRow[]> {
  const rows = (await db.execute(sql`
    SELECT id, kind, recipients, failed_recipients, subject, body_text, sent_at, created_by, created_at
    FROM clinic_notices WHERE clinic_id = ${clinicId}
    ORDER BY created_at DESC LIMIT ${limit}
  `)) as unknown as Array<{
    id: string;
    kind: NoticeKind;
    recipients: string[];
    failed_recipients: string[];
    subject: string;
    body_text: string;
    sent_at: Date | null;
    created_by: string | null;
    created_at: Date;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    recipients: r.recipients ?? [],
    failedRecipients: r.failed_recipients ?? [],
    subject: r.subject,
    bodyText: r.body_text,
    sentAt: r.sent_at ? new Date(r.sent_at) : null,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at),
  }));
}

/** Literal text[]; e-mail addresses are quoted and escaped. */
function pgTextArray(values: string[]): string {
  if (values.length === 0) return "ARRAY[]::text[]";
  return `ARRAY[${values.map((v) => `'${v.replace(/'/g, "''")}'`).join(",")}]::text[]`;
}
