import "server-only";
import { and, asc, eq, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  berlinDate,
  computeClock,
  compareByUrgency,
  eligibleInquiries,
  inquiryScanRange,
  toDayNumber,
  type ClockInput,
  type ClockState,
  type DelayRange,
  type EligibleInquiry,
  type IsoDate,
  type ManualEndState,
  type RejectionReason,
} from "@/lib/guarantee-clock";
import { classifyAttribution, type Attribution } from "@/lib/sources";
import { responseRuleStartFor } from "@/lib/response-time";
import { firstAttemptAtSql, toAttemptDate } from "@/server/queries/response-time";

/**
 * Admin-only reads for the guarantee clock (migration 0075). Everything runs
 * on the superuser `db`: the tables have no eins_app grant. Rules live in the
 * pure module lib/guarantee-clock.ts; this file only loads facts and hands
 * them over.
 */

export function todayBerlin(): IsoDate {
  return berlinDate(new Date());
}

/**
 * K-3: start of the 48-Werkstunden rule per Praxis (Berlin midnight of the
 * signing date, never before 06.10.2026). Praxen without a clock get the
 * global start. For readers outside the admin (Anfragen, monthly report)
 * that need `ruleStart` on lib/response-time inputs.
 */
export async function responseRuleStartsByClinic(clinicIds: string[]): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (clinicIds.length === 0) return out;
  const rows = await db
    .select({ clinicId: schema.guaranteeClocks.clinicId, signedOn: schema.guaranteeClocks.signedOn })
    .from(schema.guaranteeClocks)
    .where(inArray(schema.guaranteeClocks.clinicId, clinicIds));
  const signed = new Map(rows.map((r) => [r.clinicId, r.signedOn]));
  for (const id of clinicIds) out.set(id, responseRuleStartFor(signed.get(id) ?? null));
  return out;
}

export async function responseRuleStartForClinic(clinicId: string): Promise<Date> {
  return (await responseRuleStartsByClinic([clinicId])).get(clinicId) ?? responseRuleStartFor(null);
}

type ClockRow = typeof schema.guaranteeClocks.$inferSelect;
type DelayRow = typeof schema.guaranteeDelays.$inferSelect;

function delayRanges(delays: DelayRow[]): DelayRange[] {
  return delays.map((d) => ({
    from: d.fromDate,
    to: d.toDate,
    notifiedOn: d.notifiedAt ? berlinDate(d.notifiedAt) : null,
  }));
}

export function clockInputFor(
  clock: ClockRow | null,
  delays: DelayRow[],
  today: IsoDate
): ClockInput {
  return {
    signedOn: clock?.signedOn ?? null,
    delays: delayRanges(delays),
    confirmedInquiryOn: clock?.qualifyingInquiryOn ?? null,
    manualEnd:
      clock?.manualEndState && clock.manualEndOn
        ? { state: clock.manualEndState as ManualEndState, on: clock.manualEndOn }
        : null,
    today,
  };
}

const INQUIRY_COLUMNS = {
  id: schema.requests.id,
  clinicId: schema.requests.clinicId,
  createdAt: schema.requests.createdAt,
  source: schema.requests.source,
  utm: schema.requests.utm,
  contactName: schema.requests.contactName,
  contactEmail: schema.requests.contactEmail,
  contactPhone: schema.requests.contactPhone,
  treatmentWish: schema.requests.treatmentWish,
  status: schema.requests.status,
  // Folge 1 of the 48-Werkstunden rule needs the first contact attempt.
  firstAttemptAt: firstAttemptAtSql().as("first_attempt_at"),
};

export type InquirySummary = {
  id: string;
  clinicId: string;
  createdAt: Date;
  source: string;
  utm: unknown;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  treatmentWish: string | null;
  status: string;
  firstAttemptAt: Date | null;
};

type RawInquiry = Omit<InquirySummary, "firstAttemptAt"> & { firstAttemptAt: unknown };

/** Raw SQL bypasses the column decoders: turn the attempt into a Date. */
function normalizeInquiry(row: RawInquiry): InquirySummary {
  return { ...row, firstAttemptAt: toAttemptDate(row.firstAttemptAt) };
}

/** Safety cap per clinic. A 90-day window holds far fewer requests. */
export const INQUIRIES_PER_CLINIC_LIMIT = 5000;

export interface InquiryWindow {
  clinicId: string;
  signedOn: IsoDate;
  deadline: IsoDate;
}

/**
 * One query for all clinics: each clinic only scans its own window (with
 * timezone slack; the pure filter is exact), and the cap applies per clinic
 * via row_number(), so a busy clinic cannot crowd out the others. Exported
 * unexecuted so the SQL shape is testable without a DB.
 */
export function inquiriesInWindowsQuery(windows: InquiryWindow[]) {
  const r = schema.requests;
  const ranked = db
    .select({
      ...INQUIRY_COLUMNS,
      rn: sql<number>`row_number() over (partition by ${r.clinicId} order by ${r.createdAt} asc, ${r.id} asc)`.as(
        "rn"
      ),
    })
    .from(r)
    .where(
      or(
        ...windows.map((w) => {
          const range = inquiryScanRange(w.signedOn, w.deadline);
          return and(eq(r.clinicId, w.clinicId), gte(r.createdAt, range.from), lt(r.createdAt, range.before));
        })
      )
    )
    .as("ranked");

  return db
    .select({
      id: ranked.id,
      clinicId: ranked.clinicId,
      createdAt: ranked.createdAt,
      source: ranked.source,
      utm: ranked.utm,
      contactName: ranked.contactName,
      contactEmail: ranked.contactEmail,
      contactPhone: ranked.contactPhone,
      treatmentWish: ranked.treatmentWish,
      status: ranked.status,
      firstAttemptAt: ranked.firstAttemptAt,
    })
    .from(ranked)
    .where(lte(ranked.rn, INQUIRIES_PER_CLINIC_LIMIT))
    .orderBy(asc(ranked.clinicId), asc(ranked.createdAt));
}

async function inquiriesInWindows(windows: InquiryWindow[]): Promise<InquirySummary[]> {
  if (windows.length === 0) return [];
  return (await inquiriesInWindowsQuery(windows)).map(normalizeInquiry);
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface GuaranteeOverviewRow {
  clinicId: string;
  clinicName: string;
  /** For the demo filter in the admin counters (K-9). */
  clinicSlug: string;
  signedOn: IsoDate | null;
  state: ClockState;
  /** A Messweg inquiry is waiting for confirmation. */
  hasCandidate: boolean;
  openDelayCount: number;
  unnotifiedDelayCount: number;
  /** K-13: days the oldest still open Verzug has been running, 0 if none. */
  oldestOpenDelayDays: number;
}

export async function listGuaranteeOverview(): Promise<GuaranteeOverviewRow[]> {
  const today = todayBerlin();
  const [clinics, clocks, delays, rejections] = await Promise.all([
    db
      .select({ id: schema.clinics.id, name: schema.clinics.displayName, slug: schema.clinics.slug })
      .from(schema.clinics)
      .where(isNull(schema.clinics.archivedAt))
      .orderBy(asc(schema.clinics.displayName)),
    db.select().from(schema.guaranteeClocks),
    db.select().from(schema.guaranteeDelays),
    db
      .select({ requestId: schema.guaranteeCandidateRejections.requestId })
      .from(schema.guaranteeCandidateRejections),
  ]);

  const clockBy = new Map(clocks.map((c) => [c.clinicId, c]));
  const delaysBy = new Map<string, DelayRow[]>();
  for (const d of delays) {
    const list = delaysBy.get(d.clinicId) ?? [];
    list.push(d);
    delaysBy.set(d.clinicId, list);
  }
  const rejectedIds = new Set(rejections.map((r) => r.requestId));

  const rows: GuaranteeOverviewRow[] = clinics.map((c) => {
    const clock = clockBy.get(c.id) ?? null;
    const clinicDelays = delaysBy.get(c.id) ?? [];
    const openDays = clinicDelays
      .filter((d) => d.toDate === null && d.kind === "verzug")
      .map((d) => toDayNumber(today) - toDayNumber(d.fromDate) + 1);
    return {
      clinicId: c.id,
      clinicName: c.name,
      clinicSlug: c.slug,
      signedOn: clock?.signedOn ?? null,
      state: computeClock(clockInputFor(clock, clinicDelays, today)),
      hasCandidate: false,
      openDelayCount: clinicDelays.filter((d) => d.toDate === null).length,
      unnotifiedDelayCount: clinicDelays.filter((d) => !d.notifiedAt).length,
      oldestOpenDelayDays: Math.max(0, ...openDays),
    };
  });

  // Candidate flag only matters while the question is open.
  const open = rows.filter(
    (r) => r.signedOn && r.state.deadline && (r.state.status === "laeuft" || r.state.status === "beendet_ohne_anfrage")
  );
  if (open.length > 0) {
    const inquiries = await inquiriesInWindows(
      open.map((r) => ({ clinicId: r.clinicId, signedOn: r.signedOn!, deadline: r.state.deadline! }))
    );
    const byClinic = new Map<string, InquirySummary[]>();
    for (const i of inquiries) {
      const list = byClinic.get(i.clinicId) ?? [];
      list.push(i);
      byClinic.set(i.clinicId, list);
    }
    for (const r of open) {
      const mine = byClinic.get(r.clinicId) ?? [];
      r.hasCandidate =
        eligibleInquiries(mine, {
          signedOn: r.signedOn!,
          deadline: r.state.deadline!,
          rejectedIds,
        }).length > 0;
    }
  }

  return rows.sort((a, b) => compareByUrgency(a.state, b.state));
}

// ---------------------------------------------------------------------------
// Per clinic
// ---------------------------------------------------------------------------

export interface RejectedInquiry {
  rejectionId: string;
  reason: RejectionReason;
  note: string | null;
  rejectedBy: string | null;
  rejectedAt: Date;
  inquiry: InquirySummary;
  inquiryOn: IsoDate;
  attribution: Attribution;
}

export interface ClinicGuarantee {
  clinicId: string;
  clinicName: string;
  today: IsoDate;
  clock: ClockRow | null;
  input: ClockInput;
  state: ClockState;
  delays: DelayRow[];
  /** Earliest first; [0] is the proposed candidate. Empty once decided. */
  eligible: EligibleInquiry<InquirySummary>[];
  rejected: RejectedInquiry[];
  confirmed: { inquiry: InquirySummary | null; attribution: Attribution | null } | null;
  /** K-3: 48-Werkstunden rule start of this Praxis, for attemptInfo. */
  responseRuleStart: Date;
}

export async function getClinicGuarantee(clinicId: string): Promise<ClinicGuarantee | null> {
  const [clinic] = await db
    .select({ id: schema.clinics.id, name: schema.clinics.displayName })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  if (!clinic) return null;

  const today = todayBerlin();
  const [[clock], delays, rejections] = await Promise.all([
    db.select().from(schema.guaranteeClocks).where(eq(schema.guaranteeClocks.clinicId, clinicId)).limit(1),
    db
      .select()
      .from(schema.guaranteeDelays)
      .where(eq(schema.guaranteeDelays.clinicId, clinicId))
      .orderBy(asc(schema.guaranteeDelays.fromDate)),
    db
      .select({
        rejectionId: schema.guaranteeCandidateRejections.id,
        reason: schema.guaranteeCandidateRejections.reason,
        note: schema.guaranteeCandidateRejections.note,
        rejectedBy: schema.guaranteeCandidateRejections.rejectedBy,
        rejectedAt: schema.guaranteeCandidateRejections.rejectedAt,
        inquiry: INQUIRY_COLUMNS,
      })
      .from(schema.guaranteeCandidateRejections)
      .innerJoin(schema.requests, eq(schema.requests.id, schema.guaranteeCandidateRejections.requestId))
      .where(eq(schema.guaranteeCandidateRejections.clinicId, clinicId))
      .orderBy(asc(schema.requests.createdAt)),
  ]);

  const clockRow = clock ?? null;
  const input = clockInputFor(clockRow, delays, today);
  const state = computeClock(input);

  let eligible: EligibleInquiry<InquirySummary>[] = [];
  const undecided = state.status === "laeuft" || state.status === "beendet_ohne_anfrage";
  if (clockRow && state.deadline && undecided) {
    const inquiries = await inquiriesInWindows([
      { clinicId, signedOn: clockRow.signedOn, deadline: state.deadline },
    ]);
    eligible = eligibleInquiries(inquiries, {
      signedOn: clockRow.signedOn,
      deadline: state.deadline,
      rejectedIds: new Set(rejections.map((r) => r.inquiry.id)),
    });
  }

  let confirmed: ClinicGuarantee["confirmed"] = null;
  if (clockRow?.qualifyingInquiryOn) {
    let inquiry: InquirySummary | null = null;
    if (clockRow.qualifyingRequestId) {
      const [row] = await db
        .select(INQUIRY_COLUMNS)
        .from(schema.requests)
        .where(eq(schema.requests.id, clockRow.qualifyingRequestId))
        .limit(1);
      inquiry = row ? normalizeInquiry(row) : null;
    }
    confirmed = {
      inquiry,
      attribution: inquiry ? classifyAttribution({ source: inquiry.source, utm: inquiry.utm }) : null,
    };
  }

  return {
    clinicId,
    clinicName: clinic.name,
    today,
    clock: clockRow,
    input,
    state,
    delays,
    eligible,
    rejected: rejections.map((r) => ({
      rejectionId: r.rejectionId,
      reason: r.reason as RejectionReason,
      note: r.note,
      rejectedBy: r.rejectedBy,
      rejectedAt: r.rejectedAt,
      inquiry: normalizeInquiry(r.inquiry),
      inquiryOn: berlinDate(r.inquiry.createdAt),
      attribution: classifyAttribution({ source: r.inquiry.source, utm: r.inquiry.utm }),
    })),
    confirmed,
    responseRuleStart: responseRuleStartFor(clockRow?.signedOn ?? null),
  };
}

/** Load one inquiry of this clinic, for the confirm action. */
export async function getClinicInquiry(
  clinicId: string,
  requestId: string
): Promise<InquirySummary | null> {
  const [row] = await db
    .select(INQUIRY_COLUMNS)
    .from(schema.requests)
    .where(and(eq(schema.requests.id, requestId), eq(schema.requests.clinicId, clinicId)))
    .limit(1);
  return row ? normalizeInquiry(row) : null;
}

export async function loadClockFacts(clinicId: string): Promise<{
  clock: ClockRow | null;
  delays: DelayRow[];
}> {
  const [[clock], delays] = await Promise.all([
    db.select().from(schema.guaranteeClocks).where(eq(schema.guaranteeClocks.clinicId, clinicId)).limit(1),
    db.select().from(schema.guaranteeDelays).where(eq(schema.guaranteeDelays.clinicId, clinicId)),
  ]);
  return { clock: clock ?? null, delays };
}

/**
 * First-invoice dates (H-08, migration 0086, raw SQL without Drizzle mirror).
 * Returns nulls if the columns do not exist yet (migration not applied).
 */
export async function loadInvoiceDates(
  clinicId: string
): Promise<{ sentOn: IsoDate | null; paidOn: IsoDate | null }> {
  try {
    const rows = (await db.execute(sql`
      SELECT to_char(first_invoice_sent_on, 'YYYY-MM-DD') AS sent_on,
             to_char(first_invoice_paid_on, 'YYYY-MM-DD') AS paid_on
      FROM guarantee_clocks WHERE clinic_id = ${clinicId}
    `)) as unknown as Array<{ sent_on: string | null; paid_on: string | null }>;
    return { sentOn: rows[0]?.sent_on ?? null, paidOn: rows[0]?.paid_on ?? null };
  } catch (err) {
    console.error("[guarantee-clock] invoice dates unavailable (migration 0086?):", err);
    return { sentOn: null, paidOn: null };
  }
}
