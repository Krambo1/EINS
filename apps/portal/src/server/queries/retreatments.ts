import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { schema, withClinicContext } from "@/db/client";
import type { CurrencyCode } from "@/lib/formatting";
import {
  addDays,
  berlinDay,
  CALLED_TERMIN_HOLD_DAYS,
  FORECAST_WINDOW_DAYS,
  WORKING_REQUEST_STATUSES,
  type CycleStatus,
  type RetreatmentCallOutcome,
  type RetreatmentMode,
} from "@/lib/retreatment";

/**
 * Wiederbehandlungen reads. They run under the clinic's RLS context
 * (dbApp via withClinicContext): retreatment_cycles carries a tenant policy.
 */

export interface RetreatmentTreatmentSetting {
  id: string;
  name: string;
  mode: RetreatmentMode;
  intervalMonths: number | null;
  pvsIntervalDays: number | null;
  pvsSamples: number;
  pvsPatients: number;
  pvsComputedAt: Date | null;
}

export interface RetreatmentSettingsData {
  clinicName: string;
  remindersEnabled: boolean;
  consentAttested: boolean;
  bookingUrl: string | null;
  phone: string | null;
  treatments: RetreatmentTreatmentSetting[];
  lastComputedAt: Date | null;
}

/** Light read for the settings page and onboarding: no retreatment_cycles rows. */
export async function getRetreatmentSettings(
  clinicId: string,
  userId: string | null
): Promise<RetreatmentSettingsData> {
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [clinic] = await tx
        .select({
          displayName: schema.clinics.displayName,
          enabled: schema.clinics.retreatmentRemindersEnabled,
          attested: schema.clinics.retreatmentConsentAttested,
          bookingUrl: schema.clinics.retreatmentBookingUrl,
          phone: schema.clinics.retreatmentPhone,
        })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, clinicId))
        .limit(1);

      const treatments = await tx
        .select({
          id: schema.treatments.id,
          name: schema.treatments.name,
          mode: schema.treatments.retreatmentMode,
          intervalMonths: schema.treatments.retreatmentIntervalMonths,
          pvsIntervalDays: schema.treatments.pvsRetreatmentIntervalDays,
          pvsSamples: schema.treatments.pvsRetreatmentSamples,
          pvsPatients: schema.treatments.pvsRetreatmentPatients,
          pvsComputedAt: schema.treatments.pvsRetreatmentComputedAt,
        })
        .from(schema.treatments)
        .where(
          and(
            eq(schema.treatments.clinicId, clinicId),
            eq(schema.treatments.isActive, true),
            isNull(schema.treatments.archivedAt)
          )
        )
        .orderBy(asc(schema.treatments.displayOrder), asc(schema.treatments.name));

      const computed = treatments
        .map((x) => x.pvsComputedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime());

      return {
        clinicName: clinic?.displayName ?? "Ihre Praxis",
        remindersEnabled: !!clinic?.enabled,
        consentAttested: !!clinic?.attested,
        bookingUrl: clinic?.bookingUrl ?? null,
        phone: clinic?.phone ?? null,
        treatments: treatments.map((x) => ({ ...x, mode: x.mode as RetreatmentMode })),
        lastComputedAt: computed[0] ?? null,
      };
    },
    "retreatment-settings"
  );
}

// ---------------------------------------------------------------------------
// Wiederbehandlungen on /anfragen: the call cards, the list tag, the Anfrage
// ---------------------------------------------------------------------------

/** One cycle as the call cards, the list and the Anfrage page show it. */
export interface RetreatmentCall {
  id: string;
  requestId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  patientEmail: string | null;
  treatmentName: string;
  cycleOn: string;
  dueOn: string;
  status: CycleStatus;
  bookedFor: string | null;
  returnedOn: string | null;
  cycleRevenueCents: number | null;
  reminderStatus: string;
  reminderSentAt: Date | null;
  reminderSkipReason: string | null;
  bookingClickedAt: Date | null;
  /** What the patient wrote in the EINS request back then, and when. */
  requestMessage: string | null;
  requestCreatedAt: Date | null;
  lastCallAt: Date | null;
  lastCallOutcome: RetreatmentCallOutcome | null;
}

/** What every view of a cycle needs from the Praxis besides the row. */
export interface RetreatmentContext {
  today: string;
  remindersEnabled: boolean;
  currency: CurrencyCode;
}

type Tx = Parameters<Parameters<typeof withClinicContext>[2]>[0];

const cy = schema.retreatmentCycles;
const callColumns = {
  id: cy.id,
  requestId: cy.requestId,
  patientName: schema.patients.fullName,
  contactName: schema.requests.contactName,
  patientPhone: schema.patients.phone,
  contactPhone: schema.requests.contactPhone,
  patientEmail: schema.patients.email,
  contactEmail: schema.requests.contactEmail,
  treatmentName: schema.treatments.name,
  cycleOn: cy.cycleOn,
  dueOn: cy.dueOn,
  status: cy.status,
  bookedFor: cy.bookedFor,
  returnedOn: cy.returnedOn,
  cycleRevenueCents: cy.cycleRevenueCents,
  reminderStatus: cy.reminderStatus,
  reminderSentAt: cy.reminderSentAt,
  reminderSkipReason: cy.reminderSkipReason,
  bookingClickedAt: cy.bookingClickedAt,
  requestMessage: schema.requests.message,
  requestCreatedAt: schema.requests.createdAt,
  lastCallAt: cy.lastCallAt,
  lastCallOutcome: cy.lastCallOutcome,
};

function selectCalls(tx: Tx) {
  return tx
    .select(callColumns)
    .from(cy)
    .innerJoin(schema.treatments, eq(cy.treatmentId, schema.treatments.id))
    .innerJoin(schema.patients, eq(cy.patientId, schema.patients.id))
    .leftJoin(schema.requests, eq(cy.requestId, schema.requests.id));
}

type CallRow = Awaited<ReturnType<typeof selectCalls>>[number];

function toCall(r: CallRow): RetreatmentCall {
  // Name and contact as the patient gave them in the EINS request, else the
  // PVS record, as on the old calendar.
  return {
    id: r.id,
    requestId: r.requestId,
    patientName: r.contactName ?? r.patientName ?? null,
    patientPhone: r.contactPhone ?? r.patientPhone ?? null,
    patientEmail: r.contactEmail ?? r.patientEmail ?? null,
    treatmentName: r.treatmentName,
    cycleOn: r.cycleOn,
    dueOn: r.dueOn,
    status: r.status as CycleStatus,
    bookedFor: r.bookedFor,
    returnedOn: r.returnedOn,
    cycleRevenueCents: r.cycleRevenueCents,
    reminderStatus: r.reminderStatus,
    reminderSentAt: r.reminderSentAt,
    reminderSkipReason: r.reminderSkipReason,
    bookingClickedAt: r.bookingClickedAt,
    requestMessage: r.requestMessage,
    requestCreatedAt: r.requestCreatedAt,
    lastCallAt: r.lastCallAt,
    lastCallOutcome: (r.lastCallOutcome as RetreatmentCallOutcome | null) ?? null,
  };
}

async function contextOf(tx: Tx, clinicId: string, today: string): Promise<RetreatmentContext> {
  const [clinic] = await tx
    .select({ currency: schema.clinics.currency, enabled: schema.clinics.retreatmentRemindersEnabled })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, clinicId))
    .limit(1);
  return {
    today,
    remindersEnabled: !!clinic?.enabled,
    currency: (clinic?.currency === "CHF" ? "CHF" : "EUR") as CurrencyCode,
  };
}

/** The cycle's Anfrage is not one the call cards already work as an Anfrage. */
function notAWorkingAnfrage() {
  return sql`(${schema.requests.status} IS NULL OR ${schema.requests.status} NOT IN (${sql.join(
    WORKING_REQUEST_STATUSES.map((s) => sql`${s}`),
    sql`, `
  )}))`;
}

/** Calls with "Termin vereinbart" after this point still wait for the PVS. */
export function calledTerminHoldSince(now: Date): Date {
  return new Date(now.getTime() - CALLED_TERMIN_HOLD_DAYS * 86_400_000);
}

/**
 * A cycle the call cards call: open, due today or earlier, and not waiting
 * for a date the team made on the phone. A patient whose Anfrage is still
 * worked is left out: the call cards call that Anfrage.
 */
function dueCall(clinicId: string, now: Date, today: string) {
  return and(
    eq(cy.clinicId, clinicId),
    eq(cy.status, "open"),
    lte(cy.dueOn, today),
    sql`(${cy.lastCallOutcome} IS DISTINCT FROM 'termin_vereinbart' OR ${cy.lastCallAt} <= ${calledTerminHoldSince(now).toISOString()}::timestamptz)`,
    notAWorkingAnfrage()
  );
}

/**
 * Due Wiederbehandlungen for the call cards (`dueCall`). Nobody called yet
 * comes first, most recently due first (the old calendar's call list); after
 * them the ones not reached, longest since the last try first.
 */
export async function retreatmentCallQueue(
  clinicId: string,
  userId: string | null,
  limit = 6
): Promise<RetreatmentContext & { calls: RetreatmentCall[] }> {
  const now = new Date();
  const today = berlinDay(now);
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const ctx = await contextOf(tx, clinicId, today);
      const rows = await selectCalls(tx)
        .where(dueCall(clinicId, now, today))
        .orderBy(sql`${cy.lastCallAt} IS NULL DESC`, asc(cy.lastCallAt), desc(cy.dueOn))
        .limit(limit);
      return { ...ctx, calls: rows.map(toCall) };
    },
    "retreatment-call-queue"
  );
}

export type RetreatmentTagState = "faellig" | "termin" | "bald";

/** The Wiederbehandlung an Anfrage of the list carries as its tag. */
export interface RetreatmentTag {
  state: RetreatmentTagState;
  call: RetreatmentCall;
  /** Cycles of this Anfrage in the tag set (several treatments). */
  count: number;
}

const TAG_RANK: Record<RetreatmentTagState, number> = { faellig: 0, termin: 1, bald: 2 };

/**
 * Per Anfrage of the visible list page, the Wiederbehandlung it shows in its
 * status column: everyone the old calendar listed (open or booked, due in
 * the next 90 days or earlier). Due beats a date, a date beats later; the
 * earliest due wins a tie. Anfragen still worked keep their own status.
 *
 * `includeWorking` is for the call cards: the refresh ties a cycle to the
 * patient's latest Anfrage, so a treated patient who writes again has the
 * due Wiederbehandlung on a new Anfrage that is still worked. That Anfrage's
 * call card names it, so the call covers both.
 */
export async function retreatmentTagsForRequests(
  clinicId: string,
  userId: string | null,
  requestIds: string[],
  { includeWorking = false }: { includeWorking?: boolean } = {}
): Promise<Map<string, RetreatmentTag>> {
  const tags = new Map<string, RetreatmentTag>();
  if (requestIds.length === 0) return tags;
  const now = new Date();
  const today = berlinDay(now);
  const hold = calledTerminHoldSince(now);
  const rows = await withClinicContext(
    clinicId,
    userId,
    (tx) =>
      selectCalls(tx)
        .where(
          and(
            eq(cy.clinicId, clinicId),
            inArray(cy.requestId, requestIds),
            inArray(cy.status, ["open", "booked"]),
            lte(cy.dueOn, addDays(today, FORECAST_WINDOW_DAYS)),
            includeWorking ? undefined : notAWorkingAnfrage()
          )
        )
        .orderBy(asc(cy.dueOn)),
    "retreatment-tags"
  );
  for (const row of rows) {
    const call = toCall(row);
    if (!call.requestId) continue;
    const state = retreatmentTagState(call, today, hold);
    const prev = tags.get(call.requestId);
    if (!prev) tags.set(call.requestId, { state, call, count: 1 });
    else {
      prev.count += 1;
      if (TAG_RANK[state] < TAG_RANK[prev.state]) {
        prev.state = state;
        prev.call = call;
      }
    }
  }
  return tags;
}

/** Due, a date (from the PVS or made on the phone), or still ahead. */
export function retreatmentTagState(call: RetreatmentCall, today: string, hold: Date): RetreatmentTagState {
  if (call.status === "booked") return "termin";
  if (call.lastCallOutcome === "termin_vereinbart" && call.lastCallAt && call.lastCallAt > hold) {
    return "termin";
  }
  return call.dueOn <= today ? "faellig" : "bald";
}

/** Every cycle of one Anfrage, newest first, for the Anfrage page. */
export async function retreatmentsForRequest(
  clinicId: string,
  userId: string | null,
  requestId: string
): Promise<RetreatmentContext & { calls: RetreatmentCall[] }> {
  const today = berlinDay(new Date());
  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const ctx = await contextOf(tx, clinicId, today);
      const rows = await selectCalls(tx)
        .where(and(eq(cy.clinicId, clinicId), eq(cy.requestId, requestId)))
        .orderBy(desc(cy.cycleOn), asc(schema.treatments.name))
        .limit(12);
      return { ...ctx, calls: rows.map(toCall) };
    },
    "retreatment-request"
  );
}
