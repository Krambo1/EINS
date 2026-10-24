"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { sendClinicNotice } from "@/server/clinic-notices";
import { stoerungNoticeText, verzugNoticeText } from "@/server/email/templates/clinic-notice";
import { markTestInquiryAsSpam, restoreTestInquiryStatus } from "@/server/guarantee-test-spam";
import { invalidateClinicKpiCache } from "@/server/queries/_cache";
import { z } from "zod";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  clockInputFor,
  getClinicGuarantee,
  getClinicInquiry,
  loadClockFacts,
  loadInvoiceDates,
  todayBerlin,
} from "@/server/guarantee-clock";
import {
  MANUAL_END_STATES,
  NOTICE_AFTER_DEADLINE,
  REJECTION_REASONS,
  addDays,
  berlinDate,
  checkConfirmable,
  computeDeadline,
  confirmBlockReason,
  eligibleInquiries,
  formatIsoDate,
  hasContactData,
  isIsoDate,
  noticeInTime,
  rejectionAllowed,
  toDayNumber,
  verzugRange,
  type DelayRange,
} from "@/lib/guarantee-clock";
import { attemptInfo, responseRuleStartFor } from "@/lib/response-time";
import { classifyAttribution } from "@/lib/sources";
import { GARANTIE_FEHLER_COOKIE, GARANTIE_FEHLER_MAX_AGE } from "./fehler-cookie";

/**
 * Admin actions for the guarantee clock (migration 0075). Superuser `db`,
 * requireAdmin on every call. Audit rows are written WITHOUT clinicId on
 * purpose: the Praxis sees its own audit rows under Einstellungen, and the
 * clock must stay invisible to it for now. The clinic id goes into entityId.
 *
 * Business-rule failures throw `GuaranteeFail`; the exported wrappers at the
 * end turn it into a short-lived cookie that the page shows as the red
 * notice, instead of an error boundary. No `redirect(...?fehler=...)`: under
 * the admin host rewrite that rendered "Seite nicht gefunden" (V7 5.6, see
 * `fehler-cookie.ts`).
 */

const IsoDateSchema = z.string().refine(isIsoDate, "Ungültiges Datum");
const OptionalIsoDate = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || isIsoDate(v), "Ungültiges Datum");
const Uuid = z.string().uuid();

function pagePath(clinicId: string): string {
  return `/admin/garantie/${clinicId}`;
}

class GuaranteeFail extends Error {
  constructor(
    readonly clinicId: string,
    message: string
  ) {
    super(message);
  }
}

function fail(clinicId: string, message: string): never {
  throw new GuaranteeFail(clinicId, message);
}

/** Runs one action; a business-rule failure becomes the page notice. */
async function withFailNotice(run: () => Promise<void>): Promise<void> {
  const jar = await cookies();
  try {
    await run();
  } catch (err) {
    if (!(err instanceof GuaranteeFail)) throw err;
    jar.set(GARANTIE_FEHLER_COOKIE, JSON.stringify({ clinicId: err.clinicId, message: err.message }), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: GARANTIE_FEHLER_MAX_AGE,
      path: "/",
    });
    refresh(err.clinicId);
    return;
  }
  if (jar.has(GARANTIE_FEHLER_COOKIE)) jar.delete(GARANTIE_FEHLER_COOKIE);
}

function refresh(clinicId: string): void {
  revalidatePath("/admin/garantie");
  revalidatePath(pagePath(clinicId));
}

/** D6: the same refresh as a status change on the Praxis side (revalidateLead). */
async function refreshPraxisRequest(clinicId: string, requestId: string): Promise<void> {
  revalidatePath(`/anfragen/${requestId}`);
  revalidatePath("/anfragen");
  await invalidateClinicKpiCache(clinicId);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * G-16: a Garantie mutation and its audit row commit together. `writeAudit`
 * swallows errors and runs after the change; here the audit insert runs in
 * the same transaction, so a failed audit rolls the change back.
 */
async function auditTx(
  tx: Tx,
  actorEmail: string,
  action: string,
  clinicId: string,
  diff: Record<string, unknown>
) {
  const hdrs = await headers();
  await tx.insert(schema.auditLog).values({
    actorEmail,
    action,
    entityKind: "guarantee_clock",
    entityId: clinicId,
    diff,
    ipAddress:
      trustedIpFromHeaders(hdrs.get("x-forwarded-for"), hdrs.get("x-real-ip")) ?? undefined,
    userAgent: hdrs.get("user-agent") ?? undefined,
  });
}


function parse<T extends z.ZodTypeAny>(schemaDef: T, formData: FormData): z.infer<T> {
  const parsed = schemaDef.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const clinicId = formData.get("clinicId");
    const message = parsed.error.issues[0]?.message ?? "Eingabe ungültig";
    if (typeof clinicId === "string" && Uuid.safeParse(clinicId).success) fail(clinicId, message);
    throw new Error("validation failed: " + message);
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Signing date
// ---------------------------------------------------------------------------

async function setSignedOnActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, signedOn: IsoDateSchema }), formData);

  const [{ clock, delays }, invoice] = await Promise.all([loadClockFacts(d.clinicId), loadInvoiceDates(d.clinicId)]);
  // K-17: once the first invoice is out, the trigger and its window are fixed.
  if (clock && invoice.sentOn && clock.signedOn !== d.signedOn) {
    fail(d.clinicId, "Die erste Rechnung ist als gesendet vermerkt. Erst den Rechnungsvermerk entfernen.");
  }
  if (clock?.qualifyingInquiryOn && toDayNumber(clock.qualifyingInquiryOn) < toDayNumber(d.signedOn)) {
    fail(d.clinicId, "Die bestätigte Anfrage liegt vor diesem Datum. Erst die Bestätigung aufheben.");
  }
  // K-17: an earlier date can move the deadline before the confirmed inquiry.
  if (clock?.qualifyingInquiryOn) {
    const check = checkConfirmable(
      { ...clockInputFor({ ...clock, signedOn: d.signedOn }, delays, todayBerlin()), manualEnd: null },
      clock.qualifyingInquiryOn
    );
    if (!check.ok) {
      fail(d.clinicId, `Mit diesem Datum läge die bestätigte Anfrage außerhalb der Frist (${check.reason}) Erst die Bestätigung aufheben.`);
    }
  }
  if (clock?.manualEndOn && toDayNumber(clock.manualEndOn) < toDayNumber(d.signedOn)) {
    fail(d.clinicId, "Das manuelle Ende liegt vor diesem Datum. Erst das Ende aufheben.");
  }
  if (toDayNumber(d.signedOn) > toDayNumber(todayBerlin())) {
    fail(d.clinicId, "Das Unterschriftsdatum liegt in der Zukunft.");
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.guaranteeClocks)
      .values({ clinicId: d.clinicId, signedOn: d.signedOn })
      .onConflictDoUpdate({
        target: schema.guaranteeClocks.clinicId,
        set: { signedOn: d.signedOn, updatedAt: new Date() },
      });
    await auditTx(tx, admin.email, "update", d.clinicId, { signedOn: d.signedOn, before: clock?.signedOn ?? null });
  });
  refresh(d.clinicId);
}

// ---------------------------------------------------------------------------
// Delays
// ---------------------------------------------------------------------------

function notifiedAtFrom(date: string | null): Date | null {
  return date ? new Date(`${date}T12:00:00Z`) : null;
}

function delayRangesOf(delays: Array<{ fromDate: string; toDate: string | null; notifiedAt: Date | null }>): DelayRange[] {
  return delays.map((x) => ({ from: x.fromDate, to: x.toDate, notifiedOn: x.notifiedAt ? berlinDate(x.notifiedAt) : null }));
}

/**
 * K-1 / K-7: a notice date Karam enters by hand (or today, when the portal
 * sends) must not lie in the future, not before the first counted day, and
 * not after the deadline valid on that day. Fails with a German message.
 */
async function checkNoticeDate(
  clinicId: string,
  notifiedOn: string,
  firstCountedDay: string,
  excludeDelayId?: string
): Promise<void> {
  if (toDayNumber(notifiedOn) > toDayNumber(todayBerlin())) {
    fail(clinicId, "Das Mitteilungsdatum liegt in der Zukunft.");
  }
  if (toDayNumber(notifiedOn) < toDayNumber(firstCountedDay) - 1) {
    fail(clinicId, "Das Mitteilungsdatum liegt vor dem eingetragenen Zeitraum.");
  }
  const { clock, delays } = await loadClockFacts(clinicId);
  if (!clock) fail(clinicId, "Erst das Unterschriftsdatum eintragen.");
  const others = delays.filter((x) => x.id !== excludeDelayId);
  if (!noticeInTime(clock.signedOn, delayRangesOf(others), notifiedOn)) fail(clinicId, NOTICE_AFTER_DEADLINE);
}

/** K-7: "Die Frist endet damit am …" for the notice text, as of today. */
function deadlineLine(
  clock: { signedOn: string },
  delays: DelayRange[],
  open: boolean,
  openSubject = "die Mitwirkung"
): string {
  const { deadline } = computeDeadline(clock.signedOn, delays, todayBerlin());
  return open
    ? `Stand heute endet die 90-Tage-Frist damit am ${formatIsoDate(deadline)}. Solange ${openSubject} offen ist, verschiebt sich dieses Datum um jeden weiteren Tag.`
    : `Die 90-Tage-Frist endet damit am ${formatIsoDate(deadline)}.`;
}

/** Insert the deadline line before the closing lines of the notice body. */
function withDeadlineLine(body: string, line: string): string {
  const marker = "\n\nWenn Sie Fragen haben";
  const i = body.indexOf(marker);
  return i === -1 ? `${body}\n\n${line}` : `${body.slice(0, i)}\n\n${line}${body.slice(i)}`;
}

const Beleg = z
  .string()
  .trim()
  .max(500)
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

async function addVerzugActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      missedDeadlineOn: IsoDateSchema,
      fulfilledOn: OptionalIsoDate,
      reason: z.string().trim().min(2, "Bitte einen Grund angeben").max(500),
      notifiedOn: OptionalIsoDate,
      // K-7: proof for a notice Karam sent himself (e.g. Message-ID, Betreff).
      beleg: Beleg,
      // H-03: "1" = send the Verzug notice by e-mail now and store it.
      sendNotice: z.literal("1").optional(),
    }),
    formData
  );

  const range = verzugRange(d.missedDeadlineOn, d.fulfilledOn);
  if (!range) fail(d.clinicId, "Am Fälligkeitstag erfüllt: kein Verzugstag.");
  if (d.sendNotice === "1" && d.notifiedOn) {
    fail(d.clinicId, "Entweder jetzt senden oder ein eigenes Mitteilungsdatum eintragen, nicht beides.");
  }
  if (d.notifiedOn && !d.beleg) {
    fail(d.clinicId, "Bitte einen Beleg für die selbst gesendete Mitteilung angeben (z. B. Betreff und Uhrzeit der E-Mail).");
  }
  const noticeOn = d.sendNotice === "1" ? todayBerlin() : d.notifiedOn;
  if (noticeOn) await checkNoticeDate(d.clinicId, noticeOn, range.from);

  let notice: Awaited<ReturnType<typeof sendClinicNotice>> | null = null;
  if (d.sendNotice === "1") {
    const text = verzugNoticeText({ reason: d.reason, dueOn: d.missedDeadlineOn, fulfilledOn: d.fulfilledOn });
    const { clock, delays } = await loadClockFacts(d.clinicId);
    const withNew = [...delayRangesOf(delays), { ...range, notifiedOn: todayBerlin() }];
    notice = await sendClinicNotice({
      clinicId: d.clinicId,
      kind: "verzug",
      subject: text.subject,
      body: clock ? withDeadlineLine(text.body, deadlineLine(clock, withNew, range.to === null)) : text.body,
      createdBy: admin.email,
    });
    if (!notice.sentAt) {
      fail(d.clinicId, "Die Verzugs-Mitteilung konnte an niemanden zugestellt werden. Nichts eingetragen. Empfänger prüfen.");
    }
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.guaranteeDelays)
      .values({
        clinicId: d.clinicId,
        kind: "verzug",
        fromDate: range.from,
        toDate: range.to,
        reason: d.reason,
        notifiedAt: notice?.sentAt ?? notifiedAtFrom(d.notifiedOn),
        createdBy: admin.email,
      })
      .returning({ id: schema.guaranteeDelays.id });
    if (notice && row) {
      await tx.execute(sql`UPDATE guarantee_delays SET notice_id = ${notice.id} WHERE id = ${row.id}`);
    }
    await auditTx(tx, admin.email, "create", d.clinicId, {
      delayId: row?.id,
      kind: "verzug",
      reason: d.reason,
      ...range,
      ...(notice ? { noticeId: notice.id, recipients: notice.recipients } : {}),
      ...(d.notifiedOn ? { notifiedOn: d.notifiedOn, beleg: d.beleg } : {}),
    });
  });
  refresh(d.clinicId);
}

async function addStoerungActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      fromDate: IsoDateSchema,
      toDate: OptionalIsoDate,
      reason: z.string().trim().min(2, "Bitte einen Grund angeben").max(500),
      notifiedOn: OptionalIsoDate,
      beleg: Beleg,
    }),
    formData
  );
  if (d.toDate && toDayNumber(d.toDate) < toDayNumber(d.fromDate)) {
    fail(d.clinicId, "Der letzte Tag liegt vor dem ersten.");
  }
  if (d.notifiedOn) {
    if (!d.beleg) {
      fail(d.clinicId, "Bitte einen Beleg für die Mitteilung angeben (z. B. Betreff und Uhrzeit der E-Mail).");
    }
    await checkNoticeDate(d.clinicId, d.notifiedOn, d.fromDate);
  }

  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(schema.guaranteeDelays)
      .values({
        clinicId: d.clinicId,
        kind: "plattform_stoerung",
        fromDate: d.fromDate,
        toDate: d.toDate,
        reason: d.reason,
        notifiedAt: notifiedAtFrom(d.notifiedOn),
        createdBy: admin.email,
      })
      .returning({ id: schema.guaranteeDelays.id });
    await auditTx(tx, admin.email, "create", d.clinicId, {
      delayId: row?.id,
      kind: "plattform_stoerung",
      reason: d.reason,
      from: d.fromDate,
      to: d.toDate,
      ...(d.notifiedOn ? { notifiedOn: d.notifiedOn, beleg: d.beleg } : {}),
    });
  });
  refresh(d.clinicId);
}

async function closeDelayActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, delayId: Uuid, toDate: IsoDateSchema }), formData);

  const [delay] = await db
    .select()
    .from(schema.guaranteeDelays)
    .where(and(eq(schema.guaranteeDelays.id, d.delayId), eq(schema.guaranteeDelays.clinicId, d.clinicId)))
    .limit(1);
  if (!delay) fail(d.clinicId, "Eintrag nicht gefunden.");
  if (toDayNumber(d.toDate) < toDayNumber(delay.fromDate)) {
    fail(d.clinicId, "Das Enddatum liegt vor dem ersten gezählten Tag. Dann den Eintrag lieber entfernen.");
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.guaranteeDelays)
      .set({ toDate: d.toDate })
      .where(eq(schema.guaranteeDelays.id, d.delayId));
    await auditTx(tx, admin.email, "update", d.clinicId, {
      delayId: d.delayId,
      toDate: { from: delay.toDate, to: d.toDate },
      reason: delay.reason,
    });
  });
  refresh(d.clinicId);
}

async function markDelayNotifiedActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      delayId: Uuid,
      notifiedOn: IsoDateSchema,
      beleg: z.string().trim().min(3, "Bitte einen Beleg angeben (z. B. Betreff und Uhrzeit der E-Mail)").max(500),
    }),
    formData
  );

  // K-7: a notice the portal sent keeps its real send time.
  const [current] = (await db.execute(sql`
    SELECT from_date::text AS from_date, notice_id FROM guarantee_delays
    WHERE id = ${d.delayId} AND clinic_id = ${d.clinicId}
  `)) as unknown as Array<{ from_date: string; notice_id: string | null }>;
  if (!current) fail(d.clinicId, "Eintrag nicht gefunden.");
  if (current.notice_id) {
    fail(d.clinicId, "Diese Mitteilung wurde aus dem Portal gesendet. Ihr Datum ist die echte Sendezeit und bleibt.");
  }
  await checkNoticeDate(d.clinicId, d.notifiedOn, current.from_date, d.delayId);

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({ notifiedAt: schema.guaranteeDelays.notifiedAt })
      .from(schema.guaranteeDelays)
      .where(and(eq(schema.guaranteeDelays.id, d.delayId), eq(schema.guaranteeDelays.clinicId, d.clinicId)))
      .limit(1);
    if (!before) return;
    await tx
      .update(schema.guaranteeDelays)
      .set({ notifiedAt: notifiedAtFrom(d.notifiedOn) })
      .where(and(eq(schema.guaranteeDelays.id, d.delayId), eq(schema.guaranteeDelays.clinicId, d.clinicId)));
    await auditTx(tx, admin.email, "update", d.clinicId, {
      delayId: d.delayId,
      notifiedAt: { from: before.notifiedAt ? before.notifiedAt.toISOString() : null, to: d.notifiedOn },
      beleg: d.beleg,
    });
  });
  refresh(d.clinicId);
}

async function removeDelayActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, delayId: Uuid }), formData);

  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(schema.guaranteeDelays)
      .where(and(eq(schema.guaranteeDelays.id, d.delayId), eq(schema.guaranteeDelays.clinicId, d.clinicId)))
      .returning();
    if (!removed) return;
    // G-21: the trail keeps what was removed (the Frist moves back by it).
    await auditTx(tx, admin.email, "delete", d.clinicId, {
      delayId: d.delayId,
      kind: removed.kind,
      from: removed.fromDate,
      to: removed.toDate,
      reason: removed.reason,
      notifiedAt: removed.notifiedAt ? removed.notifiedAt.toISOString() : null,
    });
  });
  refresh(d.clinicId);
}

// ---------------------------------------------------------------------------
// First qualified inquiry
// ---------------------------------------------------------------------------

async function confirmInquiryActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      requestId: Uuid,
      // K-2: Karam skips an earlier possible inquiry on purpose (note required).
      skipEarlier: z.literal("1").optional(),
      skipNote: z.string().trim().max(500).optional(),
    }),
    formData
  );

  const [{ clock, delays }, inquiry, [rejected]] = await Promise.all([
    loadClockFacts(d.clinicId),
    getClinicInquiry(d.clinicId, d.requestId),
    db
      .select({ id: schema.guaranteeCandidateRejections.id })
      .from(schema.guaranteeCandidateRejections)
      .where(eq(schema.guaranteeCandidateRejections.requestId, d.requestId))
      .limit(1),
  ]);
  if (!clock) fail(d.clinicId, "Erst das Unterschriftsdatum eintragen.");
  if (clock.qualifyingInquiryOn) fail(d.clinicId, "Es ist bereits eine Anfrage bestätigt.");
  if (!inquiry) fail(d.clinicId, "Anfrage nicht gefunden.");
  if (rejected) fail(d.clinicId, "Diese Anfrage wurde abgelehnt. Erst die Ablehnung aufheben.");

  const attribution = classifyAttribution({ source: inquiry.source, utm: inquiry.utm });
  if (!attribution.messweg) fail(d.clinicId, "Die Anfrage kam nicht über einen EINS-Messweg.");

  const inquiryOn = berlinDate(inquiry.createdAt);
  const check = checkConfirmable(clockInputFor(clock, delays, todayBerlin()), inquiryOn);
  if (!check.ok) fail(d.clinicId, check.reason);

  // K-2: contact data, spam marking and "the earliest one" (Anhang § 2 Abs. (1)).
  const skipEarlier = d.skipEarlier === "1";
  if (skipEarlier && (!d.skipNote || d.skipNote.length < 5)) {
    fail(d.clinicId, "Bitte in der Notiz festhalten, warum die frühere Anfrage übersprungen wird.");
  }
  const g = await getClinicGuarantee(d.clinicId);
  const eligible = g?.eligible ?? [];
  const position = eligible.findIndex((e) => e.row.id === inquiry.id);
  const blocked = confirmBlockReason(
    {
      hasContactData: hasContactData(inquiry),
      isSpamMarked: inquiry.status === "spam",
    },
    { earlierOpen: position > 0, skipEarlier }
  );
  if (blocked) fail(d.clinicId, blocked);
  const skipped = position > 0 ? eligible.slice(0, position).map((e) => e.row.id) : [];

  // G-09: the check above read an older snapshot. The UPDATE only wins while
  // nothing is confirmed yet, so two tabs can never overwrite each other.
  const won = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.guaranteeClocks)
      .set({
        qualifyingRequestId: inquiry.id,
        qualifyingInquiryOn: inquiryOn,
        qualifyingConfirmedBy: admin.email,
        qualifyingConfirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.guaranteeClocks.clinicId, d.clinicId),
          isNull(schema.guaranteeClocks.qualifyingInquiryOn),
          // K-16: a parallel manual end must not hit the single-outcome CHECK.
          isNull(schema.guaranteeClocks.manualEndState)
        )
      )
      .returning({ clinicId: schema.guaranteeClocks.clinicId });
    if (updated.length === 0) return false;
    await auditTx(tx, admin.email, "approve", d.clinicId, {
      requestId: inquiry.id,
      inquiryOn,
      messweg: attribution.messweg,
      ...(skipped.length > 0 ? { skippedEarlier: skipped, skipNote: d.skipNote } : {}),
    });
    return true;
  });
  if (!won) {
    fail(d.clinicId, "In der Zwischenzeit wurde bereits eine Anfrage bestätigt oder die Uhr beendet. Seite neu laden.");
  }
  refresh(d.clinicId);
}

async function undoConfirmationActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid }), formData);

  // H-08/G-09: once the first invoice is marked as sent, the trigger is fixed.
  const invoice = await loadInvoiceDates(d.clinicId);
  if (invoice.sentOn) {
    fail(d.clinicId, "Die erste Rechnung ist als gesendet vermerkt. Erst den Rechnungsvermerk entfernen.");
  }

  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        requestId: schema.guaranteeClocks.qualifyingRequestId,
        inquiryOn: schema.guaranteeClocks.qualifyingInquiryOn,
      })
      .from(schema.guaranteeClocks)
      .where(eq(schema.guaranteeClocks.clinicId, d.clinicId))
      .limit(1);
    await tx
      .update(schema.guaranteeClocks)
      .set({
        qualifyingRequestId: null,
        qualifyingInquiryOn: null,
        qualifyingConfirmedBy: null,
        qualifyingConfirmedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.guaranteeClocks.clinicId, d.clinicId));
    await auditTx(tx, admin.email, "update", d.clinicId, {
      undo: "confirmation",
      requestId: before?.requestId ?? null,
      inquiryOn: before?.inquiryOn ?? null,
    });
  });
  refresh(d.clinicId);
}

async function rejectInquiryActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      requestId: Uuid,
      reason: z.enum(REJECTION_REASONS, { errorMap: () => ({ message: "Bitte einen Grund wählen" }) }),
      note: z.string().trim().max(500).optional(),
      // Checkbox: the Praxis proved an earlier contact attempt another way.
      otherProof: z.literal("1").optional(),
    }),
    formData
  );

  const [inquiry, { clock }] = await Promise.all([
    getClinicInquiry(d.clinicId, d.requestId),
    loadClockFacts(d.clinicId),
  ]);
  if (!inquiry) fail(d.clinicId, "Anfrage nicht gefunden.");
  // G-09: rejecting the confirmed trigger would leave "Rechnung fällig" with
  // a rejected request. Undo the confirmation first.
  if (clock?.qualifyingRequestId === d.requestId) {
    fail(d.clinicId, "Diese Anfrage ist als erste qualifizierte Anfrage bestätigt. Erst die Bestätigung aufheben.");
  }

  // Folge 1 of the 48-Werkstunden rule (Garantie-Anhang § 6 Abs. (5) lit. a).
  const otherProof = d.otherProof === "1";
  if (otherProof && (!d.note || d.note.length < 5)) {
    fail(d.clinicId, "Bitte in der Notiz festhalten, wie die Praxis den früheren Kontaktversuch nachgewiesen hat.");
  }
  const attempt = attemptInfo({ ...inquiry, ruleStart: responseRuleStartFor(clock?.signedOn ?? null) }, new Date());
  const allowed = rejectionAllowed(d.reason, {
    hasContactData: Boolean(inquiry.contactPhone?.trim() || inquiry.contactEmail?.trim()),
    responseState: attempt.state,
    otherProof,
  });
  if (!allowed.ok) fail(d.clinicId, allowed.reason);

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.guaranteeCandidateRejections)
      .values({
        clinicId: d.clinicId,
        requestId: d.requestId,
        reason: d.reason,
        note: d.note && d.note.length > 0 ? d.note : null,
        rejectedBy: admin.email,
      })
      .onConflictDoNothing()
      .returning({ id: schema.guaranteeCandidateRejections.id });
    // Audit only on a real change (a second click inserts nothing).
    if (rows.length === 0) return null;
    // D6: a test entry also becomes spam, so the Praxis does not see it as
    // unanswered. Same transaction: rejection, status and audit commit together.
    const spam = await markTestInquiryAsSpam(tx, {
      clinicId: d.clinicId,
      requestId: d.requestId,
      reason: d.reason,
    });
    await auditTx(tx, admin.email, "reject", d.clinicId, {
      requestId: d.requestId,
      reason: d.reason,
      attemptState: attempt.state,
      ...(otherProof ? { otherProof: true } : {}),
      ...(spam ? { alsoSpam: true, statusBefore: spam.statusBefore } : {}),
    });
    return { spam: spam !== null };
  });
  if (!inserted) fail(d.clinicId, "Diese Anfrage ist bereits abgelehnt.");
  if (inserted.spam) await refreshPraxisRequest(d.clinicId, d.requestId);
  refresh(d.clinicId);
}

async function undoRejectionActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, rejectionId: Uuid }), formData);

  // K-16: delete and audit commit together; a second click changes nothing.
  const restored = await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(schema.guaranteeCandidateRejections)
      .where(
        and(
          eq(schema.guaranteeCandidateRejections.id, d.rejectionId),
          eq(schema.guaranteeCandidateRejections.clinicId, d.clinicId)
        )
      )
      .returning();
    if (!removed) return null;
    // D6: give a test entry its status back, unless someone changed it since.
    const plan = await restoreTestInquiryStatus(tx, {
      clinicId: d.clinicId,
      requestId: removed.requestId,
      reason: removed.reason,
    });
    await auditTx(tx, admin.email, "update", d.clinicId, {
      undo: "rejection",
      rejectionId: d.rejectionId,
      requestId: removed.requestId,
      reason: removed.reason,
      ...("restore" in plan
        ? { statusRestored: plan.restore }
        : removed.reason === "test_eintrag"
          ? { spamKept: plan.keep }
          : {}),
    });
    return "restore" in plan ? removed.requestId : null;
  });
  if (restored) await refreshPraxisRequest(d.clinicId, restored);
  refresh(d.clinicId);
}

// ---------------------------------------------------------------------------
// Manual end
// ---------------------------------------------------------------------------

async function setManualEndActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(
    z.object({
      clinicId: Uuid,
      state: z.enum(MANUAL_END_STATES),
      endedOn: IsoDateSchema,
      note: z.string().trim().max(500).optional(),
    }),
    formData
  );

  const { clock } = await loadClockFacts(d.clinicId);
  if (!clock) fail(d.clinicId, "Erst das Unterschriftsdatum eintragen.");
  if (clock.qualifyingInquiryOn) {
    fail(d.clinicId, "Es ist bereits eine Anfrage bestätigt. Die Praxis kann nur vor der ersten Rechnung beenden.");
  }
  if (toDayNumber(d.endedOn) < toDayNumber(clock.signedOn)) {
    fail(d.clinicId, "Das Ende liegt vor der Unterschrift.");
  }
  if (toDayNumber(d.endedOn) > toDayNumber(todayBerlin())) {
    fail(d.clinicId, "Das Ende darf nicht in der Zukunft liegen. Tragen Sie es am Tag des Endes ein.");
  }

  // K-16: atomic with its audit row, and only while no inquiry is confirmed
  // and no end is set (a parallel confirm would hit the single-outcome CHECK).
  const won = await db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.guaranteeClocks)
      .set({
        manualEndState: d.state,
        manualEndOn: d.endedOn,
        manualEndNote: d.note && d.note.length > 0 ? d.note : null,
        manualEndSetBy: admin.email,
        manualEndSetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.guaranteeClocks.clinicId, d.clinicId),
          isNull(schema.guaranteeClocks.qualifyingInquiryOn),
          isNull(schema.guaranteeClocks.manualEndState)
        )
      )
      .returning({ clinicId: schema.guaranteeClocks.clinicId });
    if (updated.length === 0) return false;
    await auditTx(tx, admin.email, "transition", d.clinicId, { state: d.state, endedOn: d.endedOn });
    return true;
  });
  if (!won) {
    fail(d.clinicId, "In der Zwischenzeit wurde eine Anfrage bestätigt oder ein Ende eingetragen. Seite neu laden.");
  }
  refresh(d.clinicId);
}

async function clearManualEndActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid }), formData);

  // K-16: atomic with its audit row; the trail keeps what was cleared.
  await db.transaction(async (tx) => {
    const [before] = await tx
      .select({
        state: schema.guaranteeClocks.manualEndState,
        on: schema.guaranteeClocks.manualEndOn,
        note: schema.guaranteeClocks.manualEndNote,
      })
      .from(schema.guaranteeClocks)
      .where(eq(schema.guaranteeClocks.clinicId, d.clinicId))
      .limit(1);
    if (!before?.state) return;
    await tx
      .update(schema.guaranteeClocks)
      .set({
        manualEndState: null,
        manualEndOn: null,
        manualEndNote: null,
        manualEndSetBy: null,
        manualEndSetAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.guaranteeClocks.clinicId, d.clinicId));
    await auditTx(tx, admin.email, "update", d.clinicId, { undo: "manual_end", before });
  });
  refresh(d.clinicId);
}

// ---------------------------------------------------------------------------
// First invoice (H-08). Karam invoices outside the portal; this only records
// when the first invoice went out and was paid (migration 0086).
// ---------------------------------------------------------------------------

async function setInvoiceSentActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, sentOn: IsoDateSchema }), formData);
  const { clock } = await loadClockFacts(d.clinicId);
  if (!clock?.qualifyingInquiryOn) fail(d.clinicId, "Erst die erste qualifizierte Anfrage bestätigen.");
  if (toDayNumber(d.sentOn) < toDayNumber(clock.qualifyingInquiryOn)) {
    fail(d.clinicId, "Die Rechnung kann nicht vor der bestätigten Anfrage gesendet sein.");
  }
  if (toDayNumber(d.sentOn) > toDayNumber(todayBerlin())) fail(d.clinicId, "Datum liegt in der Zukunft.");

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE guarantee_clocks SET first_invoice_sent_on = ${d.sentOn}::date, updated_at = now()
      WHERE clinic_id = ${d.clinicId}
    `);
    await auditTx(tx, admin.email, "update", d.clinicId, { firstInvoiceSentOn: d.sentOn });
  });
  refresh(d.clinicId);
}

async function setInvoicePaidActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, paidOn: IsoDateSchema }), formData);
  const invoice = await loadInvoiceDates(d.clinicId);
  if (!invoice.sentOn) fail(d.clinicId, "Erst vermerken, dass die Rechnung gesendet ist.");
  if (toDayNumber(d.paidOn) < toDayNumber(invoice.sentOn)) {
    fail(d.clinicId, "Bezahlt kann nicht vor dem Versand liegen.");
  }
  if (toDayNumber(d.paidOn) > toDayNumber(todayBerlin())) fail(d.clinicId, "Datum liegt in der Zukunft.");

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE guarantee_clocks SET first_invoice_paid_on = ${d.paidOn}::date, updated_at = now()
      WHERE clinic_id = ${d.clinicId}
    `);
    await auditTx(tx, admin.email, "update", d.clinicId, { firstInvoicePaidOn: d.paidOn });
  });
  refresh(d.clinicId);
}

async function clearInvoiceActionRun(formData: FormData) {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid }), formData);
  const before = await loadInvoiceDates(d.clinicId);
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE guarantee_clocks
      SET first_invoice_sent_on = NULL, first_invoice_paid_on = NULL, updated_at = now()
      WHERE clinic_id = ${d.clinicId}
    `);
    await auditTx(tx, admin.email, "update", d.clinicId, { undo: "invoice", before });
  });
  refresh(d.clinicId);
}

/** H-03: send the notice for an already recorded Verzug and link it. */
async function sendVerzugNoticeActionRun(formData: FormData) {
  await sendDelayNotice(formData, "verzug");
}

/** K-7 Teil 2: same for a recorded Plattform-Störung. */
async function sendStoerungNoticeActionRun(formData: FormData) {
  await sendDelayNotice(formData, "plattform_stoerung");
}

async function sendDelayNotice(formData: FormData, kind: "verzug" | "plattform_stoerung") {
  const admin = await requireAdmin();
  const d = parse(z.object({ clinicId: Uuid, delayId: Uuid }), formData);
  const [delay] = await db
    .select()
    .from(schema.guaranteeDelays)
    .where(and(eq(schema.guaranteeDelays.id, d.delayId), eq(schema.guaranteeDelays.clinicId, d.clinicId)))
    .limit(1);
  const isVerzug = kind === "verzug";
  if (!delay || delay.kind !== kind) fail(d.clinicId, isVerzug ? "Verzug nicht gefunden." : "Störung nicht gefunden.");
  if (delay.notifiedAt) {
    fail(d.clinicId, isVerzug ? "Dieser Verzug ist bereits mitgeteilt." : "Diese Störung ist bereits mitgeteilt.");
  }

  // K-1: a notice after the deadline would no longer count; do not send it.
  const today = todayBerlin();
  await checkNoticeDate(d.clinicId, today, delay.fromDate, delay.id);

  // Verzug: fromDate is the first Verzugstag = the day after the missed
  // deadline; toDate is the day of fulfilment itself (verzugRange), not the
  // day before. Störung: fromDate/toDate are the first and last day.
  const text = isVerzug
    ? verzugNoticeText({ reason: delay.reason, dueOn: addDays(delay.fromDate, -1), fulfilledOn: delay.toDate })
    : stoerungNoticeText({ reason: delay.reason, fromOn: delay.fromDate, toOn: delay.toDate });
  const { clock, delays } = await loadClockFacts(d.clinicId);
  const ranges = delayRangesOf(
    delays.map((x) => (x.id === delay.id ? { ...x, notifiedAt: new Date(`${today}T12:00:00Z`) } : x))
  );
  const notice = await sendClinicNotice({
    clinicId: d.clinicId,
    kind: isVerzug ? "verzug" : "stoerung",
    subject: text.subject,
    body: clock
      ? withDeadlineLine(
          text.body,
          deadlineLine(clock, ranges, delay.toDate === null, isVerzug ? "die Mitwirkung" : "die Störung")
        )
      : text.body,
    createdBy: admin.email,
  });
  if (!notice.sentAt) {
    fail(d.clinicId, "Die Mitteilung konnte an niemanden zugestellt werden. Empfänger prüfen.");
  }

  await db.transaction(async (tx) => {
    await tx.execute(sql`
      UPDATE guarantee_delays SET notified_at = ${notice.sentAt!.toISOString()}::timestamptz, notice_id = ${notice.id}
      WHERE id = ${d.delayId} AND clinic_id = ${d.clinicId}
    `);
    await auditTx(tx, admin.email, "update", d.clinicId, {
      delayId: d.delayId,
      noticeId: notice.id,
      recipients: notice.recipients,
      notifiedAt: notice.sentAt?.toISOString() ?? null,
    });
  });
  refresh(d.clinicId);
}

// ---------------------------------------------------------------------------
// Exported actions (each wrapped so a GuaranteeFail shows as the page notice)
// ---------------------------------------------------------------------------

export async function setSignedOnAction(formData: FormData) {
  await withFailNotice(() => setSignedOnActionRun(formData));
}
export async function addVerzugAction(formData: FormData) {
  await withFailNotice(() => addVerzugActionRun(formData));
}
export async function addStoerungAction(formData: FormData) {
  await withFailNotice(() => addStoerungActionRun(formData));
}
export async function closeDelayAction(formData: FormData) {
  await withFailNotice(() => closeDelayActionRun(formData));
}
export async function markDelayNotifiedAction(formData: FormData) {
  await withFailNotice(() => markDelayNotifiedActionRun(formData));
}
export async function removeDelayAction(formData: FormData) {
  await withFailNotice(() => removeDelayActionRun(formData));
}
export async function confirmInquiryAction(formData: FormData) {
  await withFailNotice(() => confirmInquiryActionRun(formData));
}
export async function undoConfirmationAction(formData: FormData) {
  await withFailNotice(() => undoConfirmationActionRun(formData));
}
export async function rejectInquiryAction(formData: FormData) {
  await withFailNotice(() => rejectInquiryActionRun(formData));
}
export async function undoRejectionAction(formData: FormData) {
  await withFailNotice(() => undoRejectionActionRun(formData));
}
export async function setManualEndAction(formData: FormData) {
  await withFailNotice(() => setManualEndActionRun(formData));
}
export async function clearManualEndAction(formData: FormData) {
  await withFailNotice(() => clearManualEndActionRun(formData));
}
export async function setInvoiceSentAction(formData: FormData) {
  await withFailNotice(() => setInvoiceSentActionRun(formData));
}
export async function setInvoicePaidAction(formData: FormData) {
  await withFailNotice(() => setInvoicePaidActionRun(formData));
}
export async function clearInvoiceAction(formData: FormData) {
  await withFailNotice(() => clearInvoiceActionRun(formData));
}
export async function sendVerzugNoticeAction(formData: FormData) {
  await withFailNotice(() => sendVerzugNoticeActionRun(formData));
}
export async function sendStoerungNoticeAction(formData: FormData) {
  await withFailNotice(() => sendStoerungNoticeActionRun(formData));
}
