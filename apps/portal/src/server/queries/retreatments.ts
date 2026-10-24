import "server-only";
import { and, asc, eq, isNull } from "drizzle-orm";
import { schema, withClinicContext } from "@/db/client";
import type { CurrencyCode } from "@/lib/formatting";
import {
  addDays,
  berlinDay,
  FORECAST_WINDOW_DAYS,
  summarizeForecast,
  summarizeReminders,
  type CycleStatus,
  type ForecastSummary,
  type ReminderSummary,
  type RetreatmentMode,
} from "@/lib/retreatment";

/**
 * Wiederbehandlungs-Kalender page data. Runs under the clinic's RLS context
 * (dbApp via withClinicContext): retreatment_cycles carries a tenant policy.
 */

export interface RetreatmentListRow {
  id: string;
  patientId: string;
  patientName: string | null;
  /** Phone from the EINS request, else from the patient record, for the call list. */
  patientPhone: string | null;
  requestId: string | null;
  treatmentName: string;
  cycleOn: string;
  dueOn: string;
  status: CycleStatus;
  bookedFor: string | null;
  cycleRevenueCents: number | null;
  reminderStatus: string;
  reminderSentAt: Date | null;
  reminderSkipReason: string | null;
  bookingClickedAt: Date | null;
}

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

export interface RetreatmentPageData {
  today: string;
  clinicName: string;
  currency: CurrencyCode;
  remindersEnabled: boolean;
  consentAttested: boolean;
  bookingUrl: string | null;
  phone: string | null;
  forecast: ForecastSummary;
  reminders: ReminderSummary;
  /** Open rows past their due date, oldest first: the call list. */
  overdue: RetreatmentListRow[];
  /** Open or booked rows due in the next 90 days, soonest first. */
  upcoming: RetreatmentListRow[];
  /** Rows the team took off the calendar ("nicht erinnern"), newest due first. */
  dismissed: RetreatmentListRow[];
  treatments: RetreatmentTreatmentSetting[];
  /** Any row at all, ever (drives the empty state). */
  hasAnyRow: boolean;
  /** When the nightly rebuild last ran for this Praxis (max over treatments). */
  lastComputedAt: Date | null;
}

export async function getRetreatmentPageData(
  clinicId: string,
  userId: string | null
): Promise<RetreatmentPageData> {
  const today = berlinDay(new Date());
  const monthStartDay = `${today.slice(0, 7)}-01`;

  return withClinicContext(
    clinicId,
    userId,
    async (tx) => {
      const [clinic] = await tx
        .select({
          currency: schema.clinics.currency,
          displayName: schema.clinics.displayName,
          enabled: schema.clinics.retreatmentRemindersEnabled,
          attested: schema.clinics.retreatmentConsentAttested,
          bookingUrl: schema.clinics.retreatmentBookingUrl,
          phone: schema.clinics.retreatmentPhone,
        })
        .from(schema.clinics)
        .where(eq(schema.clinics.id, clinicId))
        .limit(1);

      const t = schema.retreatmentCycles;
      const rows = await tx
        .select({
          id: t.id,
          patientId: t.patientId,
          patientName: schema.patients.fullName,
          contactName: schema.requests.contactName,
          patientPhone: schema.patients.phone,
          contactPhone: schema.requests.contactPhone,
          requestId: t.requestId,
          treatmentName: schema.treatments.name,
          cycleOn: t.cycleOn,
          dueOn: t.dueOn,
          status: t.status,
          bookedFor: t.bookedFor,
          cycleRevenueCents: t.cycleRevenueCents,
          returnedOn: t.returnedOn,
          returnedRevenueCents: t.returnedRevenueCents,
          reminderStatus: t.reminderStatus,
          reminderSentAt: t.reminderSentAt,
          reminderSkipReason: t.reminderSkipReason,
          bookingClickedAt: t.bookingClickedAt,
        })
        .from(t)
        .innerJoin(schema.treatments, eq(t.treatmentId, schema.treatments.id))
        .innerJoin(schema.patients, eq(t.patientId, schema.patients.id))
        .leftJoin(schema.requests, eq(t.requestId, schema.requests.id))
        .where(eq(t.clinicId, clinicId))
        .orderBy(asc(t.dueOn));

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

      const summaryRows = rows.map((r) => ({
        patientId: r.patientId,
        status: r.status as CycleStatus,
        dueOn: r.dueOn,
        cycleRevenueCents: r.cycleRevenueCents,
        reminderSentAt: r.reminderSentAt,
        returnedOn: r.returnedOn,
        returnedRevenueCents: r.returnedRevenueCents,
      }));

      const toList = (r: (typeof rows)[number]): RetreatmentListRow => ({
        id: r.id,
        patientId: r.patientId,
        patientName: r.contactName ?? r.patientName ?? null,
        patientPhone: r.contactPhone ?? r.patientPhone ?? null,
        requestId: r.requestId,
        treatmentName: r.treatmentName,
        cycleOn: r.cycleOn,
        dueOn: r.dueOn,
        status: r.status as CycleStatus,
        bookedFor: r.bookedFor,
        cycleRevenueCents: r.cycleRevenueCents,
        reminderStatus: r.reminderStatus,
        reminderSentAt: r.reminderSentAt,
        reminderSkipReason: r.reminderSkipReason,
        bookingClickedAt: r.bookingClickedAt,
      });

      const horizonDay = addDays(today, FORECAST_WINDOW_DAYS);

      const overdue = rows
        .filter((r) => r.status === "open" && r.dueOn < today)
        .reverse() // most recently due first: the ones still worth a call
        .map(toList);
      const upcoming = rows
        .filter(
          (r) =>
            (r.status === "open" || r.status === "booked") &&
            r.dueOn >= today &&
            r.dueOn <= horizonDay
        )
        .map(toList);
      const dismissed = rows
        .filter((r) => r.status === "dismissed")
        .reverse()
        .map(toList);

      const computed = treatments
        .map((x) => x.pvsComputedAt)
        .filter((d): d is Date => !!d)
        .sort((a, b) => b.getTime() - a.getTime());

      return {
        today,
        clinicName: clinic?.displayName ?? "Ihre Praxis",
        currency: (clinic?.currency === "CHF" ? "CHF" : "EUR") as CurrencyCode,
        remindersEnabled: !!clinic?.enabled,
        consentAttested: !!clinic?.attested,
        bookingUrl: clinic?.bookingUrl ?? null,
        phone: clinic?.phone ?? null,
        forecast: summarizeForecast(summaryRows, today),
        reminders: summarizeReminders(summaryRows, monthStartDay),
        overdue,
        upcoming,
        dismissed,
        treatments: treatments.map((x) => ({ ...x, mode: x.mode as RetreatmentMode })),
        hasAnyRow: rows.length > 0,
        lastComputedAt: computed[0] ?? null,
      };
    },
    "retreatment-page"
  );
}
