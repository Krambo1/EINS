import { and, desc, eq, inArray, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { env } from "@/lib/env";
import {
  berlinDay,
  reminderDecision,
  sinceLastVisitPhrase,
  type ReminderSkipReason,
} from "@/lib/retreatment";
import { renderRetreatmentReminderEmail } from "@/server/email/templates/retreatment-reminder";

/**
 * Wiederbehandlungs-Kalender: daily reminder tick (platform-wide).
 *
 * Picks rows that are open, still pending and whose remind_on (due date
 * minus 14 days) has arrived, for Praxen that switched reminders on AND
 * attested patient information. Rows are grouped per patient so a patient
 * with two treatments due gets ONE mail (the mail names no treatment anyway).
 *
 * Gates per row (pure rules in lib/retreatment.ts reminderDecision):
 * overdue > 60 days, no email, unsubscribed (email_suppression), reminded
 * within the last 30 days -> skipped with a reason the portal shows. No
 * booking URL and no phone -> left pending until the Praxis adds one.
 *
 * At-most-once, same as the review tick: rows flip to 'sent' (guarded on
 * still 'pending') BEFORE the email job is enqueued; if the enqueue fails the
 * rows roll back to 'pending' for the next tick.
 */
export type RetreatmentReminderTickJob = Record<string, never>;

const BATCH_LIMIT = 500;

interface DueRow {
  id: string;
  clinicId: string;
  patientId: string;
  requestId: string | null;
  cycleOn: string;
  dueOn: string;
  token: string;
  clinicName: string;
  bookingUrl: string | null;
  phone: string | null;
}

export async function processRetreatmentReminderTick(): Promise<void> {
  const today = berlinDay(new Date());
  const t = schema.retreatmentCycles;
  const c = schema.clinics;

  const due: DueRow[] = await db
    .select({
      id: t.id,
      clinicId: t.clinicId,
      patientId: t.patientId,
      requestId: t.requestId,
      cycleOn: t.cycleOn,
      dueOn: t.dueOn,
      token: t.token,
      clinicName: c.displayName,
      bookingUrl: c.retreatmentBookingUrl,
      phone: c.retreatmentPhone,
    })
    .from(t)
    .innerJoin(c, eq(t.clinicId, c.id))
    .where(
      and(
        eq(t.status, "open"),
        eq(t.reminderStatus, "pending"),
        lte(t.remindOn, today),
        eq(c.retreatmentRemindersEnabled, true),
        eq(c.retreatmentConsentAttested, true),
        isNull(c.archivedAt)
      )
    )
    .orderBy(t.clinicId, t.patientId, t.dueOn)
    .limit(BATCH_LIMIT);

  if (due.length === 0) {
    console.log("[retreatment-reminder] tick: nothing due");
    return;
  }

  const groups = new Map<string, DueRow[]>();
  for (const r of due) {
    const k = `${r.clinicId}|${r.patientId}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }

  let sent = 0;
  for (const rows of groups.values()) {
    try {
      if (await remindPatient(rows, today)) sent += 1;
    } catch (err) {
      console.error(
        `[retreatment-reminder] failed clinic=${rows[0].clinicId} patient=${rows[0].patientId}:`,
        err
      );
    }
  }
  console.log(`[retreatment-reminder] tick: ${due.length} due rows, ${groups.size} patients, ${sent} mails`);
}

async function remindPatient(rows: DueRow[], today: string): Promise<boolean> {
  const t = schema.retreatmentCycles;
  const { clinicId, patientId } = rows[0];

  const contact = await resolveContact(clinicId, patientId, rows[0].requestId);
  const email = contact.email?.trim().toLowerCase() || null;

  let suppressed = false;
  if (email) {
    const [hit] = await db
      .select({ id: schema.emailSuppression.id })
      .from(schema.emailSuppression)
      .where(
        and(eq(schema.emailSuppression.clinicId, clinicId), eq(schema.emailSuppression.email, email))
      )
      .limit(1);
    suppressed = !!hit;
  }

  const [last] = await db
    .select({ sentAt: t.reminderSentAt })
    .from(t)
    .where(and(eq(t.clinicId, clinicId), eq(t.patientId, patientId), eq(t.reminderStatus, "sent")))
    .orderBy(desc(t.reminderSentAt))
    .limit(1);
  const lastReminderDay = last?.sentAt ? berlinDay(last.sentAt) : null;

  const hasBookingPath = !!(rows[0].bookingUrl?.trim() || rows[0].phone?.trim());
  const toSend: DueRow[] = [];
  const skips = new Map<ReminderSkipReason, string[]>();
  for (const r of rows) {
    const d = reminderDecision({ dueOn: r.dueOn, today, email, suppressed, hasBookingPath, lastReminderDay });
    if (d.action === "send") toSend.push(r);
    else if (d.action === "skip") skips.set(d.reason, [...(skips.get(d.reason) ?? []), r.id]);
  }

  for (const [reason, ids] of skips) {
    await db
      .update(t)
      .set({ reminderStatus: "skipped", reminderSkipReason: reason, updatedAt: new Date() })
      .where(and(inArray(t.id, ids), eq(t.reminderStatus, "pending")));
  }
  if (toSend.length === 0 || !email) return false;

  // Claim the rows first (at-most-once). A concurrent tick claims nothing.
  const claimed = await db
    .update(t)
    .set({ reminderStatus: "sent", reminderSentAt: new Date(), reminderEmail: email, updatedAt: new Date() })
    .where(and(inArray(t.id, toSend.map((r) => r.id)), eq(t.reminderStatus, "pending")))
    .returning({ id: t.id, token: t.token });
  if (claimed.length === 0) return false;

  // "Ihr letzter Besuch ... liegt etwa X zurück": her most recent cycle in the calendar.
  const [latest] = await db
    .select({ cycleOn: t.cycleOn })
    .from(t)
    .where(and(eq(t.clinicId, clinicId), eq(t.patientId, patientId)))
    .orderBy(desc(t.cycleOn))
    .limit(1);
  const lastVisit = latest?.cycleOn ?? toSend[0].cycleOn;

  const origin = env.APP_ORIGIN.replace(/\/$/, "");
  const token = claimed[0].token;
  const base = `${origin}/api/retreatment-tokens/${encodeURIComponent(token)}`;
  const rendered = renderRetreatmentReminderEmail({
    clinicName: rows[0].clinicName,
    patientName: contact.name,
    sincePhrase: sinceLastVisitPhrase(lastVisit, today),
    bookingUrl: rows[0].bookingUrl?.trim() ? `${base}/book` : null,
    phone: rows[0].phone?.trim() || null,
    unsubscribeUrl: `${base}/unsubscribe`,
  });

  const { enqueueEmail } = await import("@/server/jobs");
  const jobId = await enqueueEmail({
    to: email,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    clinicId,
    klass: "marketing",
    unsubscribeUrl: `${base}/unsubscribe`,
  });
  if (!jobId) {
    // enqueueEmail swallows errors and returns null: release the claim.
    await db
      .update(t)
      .set({ reminderStatus: "pending", reminderSentAt: null, reminderEmail: null })
      .where(inArray(t.id, claimed.map((r) => r.id)));
    return false;
  }
  return true;
}

/** Same resolution as the review pipeline: the EINS request's contact first, then the patient row. */
async function resolveContact(
  clinicId: string,
  patientId: string,
  requestId: string | null
): Promise<{ email: string | null; name: string | null }> {
  let email: string | null = null;
  let name: string | null = null;
  if (requestId) {
    const [req] = await db
      .select({ email: schema.requests.contactEmail, name: schema.requests.contactName })
      .from(schema.requests)
      .where(and(eq(schema.requests.id, requestId), eq(schema.requests.clinicId, clinicId)))
      .limit(1);
    email = req?.email ?? null;
    name = req?.name ?? null;
  }
  if (!email || !name) {
    const [pat] = await db
      .select({ email: schema.patients.email, name: schema.patients.fullName })
      .from(schema.patients)
      .where(and(eq(schema.patients.id, patientId), eq(schema.patients.clinicId, clinicId)))
      .limit(1);
    email = email ?? pat?.email ?? null;
    name = name ?? pat?.name ?? null;
  }
  return { email, name };
}
