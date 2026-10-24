import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { classifyAttribution } from "@/lib/sources";
import {
  berlinDay,
  computePvsIntervals,
  deriveCycleRows,
  groupCycles,
  resolveInterval,
  type DerivedCycleRow,
  type RetreatmentMode,
  type TreatmentVisit,
  type UpcomingAppointment,
} from "@/lib/retreatment";
import { foldEvents } from "./pvs-status-derive";

/**
 * Wiederbehandlungs-Kalender: per-clinic rebuild (daily fan-out, plus an
 * on-demand run when the Praxis changes a setting).
 *
 *   1. Read the Praxis's whole EncounterCompleted history, map each visit to
 *      a portal treatment (pvs_treatment_mapping, status 'mapped'), and store
 *      the median repeat interval per treatment on `treatments`.
 *   2. For EINS-attributed patients (at least one request through an EINS
 *      Messweg or a Meta/Google platform form), cut their visits into cycles
 *      from the first EINS request on, and upsert one retreatment_cycles row
 *      per cycle with due date, revenue and booked state.
 *   3. Delete rows that no longer correspond to a cycle, unless a reminder
 *      already went out for them or the team hid them (decisions the Praxis
 *      has seen or made).
 *
 * Full rebuild from pvs_event_log every run, so it is idempotent and heals
 * itself after a mapping change. It never touches reminder_status (beyond
 * pending -> not_needed for cycles that turned into history), token,
 * booking_clicked_at or dismissed_*.
 *
 * Read-only on the PVS side: this does not hook into pvs-status-derive; it
 * only reuses its exported foldEvents so revenue dedup/refund netting stays
 * identical to what the Anfragen pipeline shows.
 */
export interface RetreatmentRefreshJob {
  clinicId?: string;
}

const WRITE_CHUNK = 200;

interface EncounterRow {
  bridgeSource: string;
  pvsPatientId: string;
  pvsAppointmentId: string | null;
  treatmentCode: string | null;
  day: string;
}

interface Visit extends TreatmentVisit {
  pvsAppointmentId: string | null;
}

interface DesiredRow extends DerivedCycleRow {
  patientId: string;
  treatmentId: string;
  requestId: string;
}

export async function processRetreatmentRefresh(job: RetreatmentRefreshJob): Promise<void> {
  const clinicId = job.clinicId;
  if (!clinicId) {
    console.warn("[retreatment-refresh] job without clinicId, skipping");
    return;
  }
  const now = new Date();
  const today = berlinDay(now);

  // -- Clinic config -------------------------------------------------------
  const treatments = await db
    .select({
      id: schema.treatments.id,
      mode: schema.treatments.retreatmentMode,
      months: schema.treatments.retreatmentIntervalMonths,
      isActive: schema.treatments.isActive,
      archivedAt: schema.treatments.archivedAt,
    })
    .from(schema.treatments)
    .where(eq(schema.treatments.clinicId, clinicId));
  if (treatments.length === 0) return;

  const mappings = await db
    .select({
      code: schema.pvsTreatmentMapping.pvsTreatmentCode,
      treatmentId: schema.pvsTreatmentMapping.portalTreatmentId,
    })
    .from(schema.pvsTreatmentMapping)
    .where(
      and(
        eq(schema.pvsTreatmentMapping.clinicId, clinicId),
        eq(schema.pvsTreatmentMapping.status, "mapped"),
        isNotNull(schema.pvsTreatmentMapping.portalTreatmentId)
      )
    );
  const codeToTreatment = new Map<string, string>();
  for (const m of mappings) if (m.treatmentId) codeToTreatment.set(m.code, m.treatmentId);

  const patientMap = await db
    .select({
      pvsPatientId: schema.pvsPatientMap.pvsPatientId,
      portalPatientId: schema.pvsPatientMap.portalPatientId,
    })
    .from(schema.pvsPatientMap)
    .where(eq(schema.pvsPatientMap.clinicId, clinicId));
  const pvsToPortal = new Map<string, string>();
  for (const m of patientMap) if (m.portalPatientId) pvsToPortal.set(m.pvsPatientId, m.portalPatientId);

  // -- 1. Visit history (all patients) -------------------------------------
  // Compact projection: only the payload fields we need, not whole payloads.
  const p = schema.pvsEventLog.payload;
  const history = await db
    .select({
      kind: schema.pvsEventLog.kind,
      bridgeSource: schema.pvsEventLog.bridgeSource,
      pvsPatientId: sql<string | null>`${p}->>'pvsPatientId'`,
      pvsEncounterId: sql<string | null>`${p}->>'pvsEncounterId'`,
      pvsAppointmentId: sql<string | null>`${p}->>'pvsAppointmentId'`,
      treatmentCode: sql<string | null>`${p}->>'treatmentCode'`,
      completedAt: sql<string | null>`${p}->>'completedAt'`,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, clinicId),
        inArray(schema.pvsEventLog.kind, ["EncounterCompleted", "AppointmentCreated"])
      )
    )
    .orderBy(asc(schema.pvsEventLog.occurredAt));

  // An encounter may not carry its treatment code; its appointment usually does.
  const apptCode = new Map<string, string>();
  // Re-emissions of one encounter land as separate rows (occurredAt is part of
  // the dedup key), so dedupe per (bridgeSource, pvsEncounterId); latest wins.
  const encounters = new Map<string, EncounterRow>();
  for (const r of history) {
    if (r.kind === "AppointmentCreated") {
      if (r.pvsAppointmentId && r.treatmentCode) {
        apptCode.set(`${r.bridgeSource}::${r.pvsAppointmentId}`, r.treatmentCode);
      }
      continue;
    }
    if (!r.pvsPatientId || !r.pvsEncounterId || !r.completedAt) continue;
    const completed = new Date(r.completedAt);
    if (Number.isNaN(completed.getTime())) continue;
    encounters.set(`${r.bridgeSource}::${r.pvsEncounterId}`, {
      bridgeSource: r.bridgeSource,
      pvsPatientId: r.pvsPatientId,
      pvsAppointmentId: r.pvsAppointmentId,
      treatmentCode: r.treatmentCode,
      day: berlinDay(completed),
    });
  }

  const visits: Visit[] = [];
  for (const e of encounters.values()) {
    const code =
      e.treatmentCode ??
      (e.pvsAppointmentId ? apptCode.get(`${e.bridgeSource}::${e.pvsAppointmentId}`) : undefined);
    const treatmentId = code ? codeToTreatment.get(code) : undefined;
    if (!treatmentId) continue;
    visits.push({
      patientKey: pvsToPortal.get(e.pvsPatientId) ?? `pvs:${e.bridgeSource}:${e.pvsPatientId}`,
      treatmentId,
      day: e.day,
      pvsAppointmentId: e.pvsAppointmentId,
    });
  }

  const intervals = computePvsIntervals(visits);
  for (const t of treatments) {
    const iv = intervals.get(t.id);
    await db
      .update(schema.treatments)
      .set({
        pvsRetreatmentIntervalDays: iv?.intervalDays ?? null,
        pvsRetreatmentSamples: iv?.samples ?? 0,
        pvsRetreatmentPatients: iv?.patients ?? 0,
        pvsRetreatmentComputedAt: now,
      })
      .where(and(eq(schema.treatments.id, t.id), eq(schema.treatments.clinicId, clinicId)));
  }

  // -- 2. EINS-attributed patients -----------------------------------------
  const requests = await db
    .select({
      id: schema.requests.id,
      patientId: schema.requests.patientId,
      source: schema.requests.source,
      utm: schema.requests.utm,
      createdAt: schema.requests.createdAt,
    })
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        isNotNull(schema.requests.patientId),
        ne(schema.requests.status, "spam")
      )
    )
    .orderBy(asc(schema.requests.createdAt));

  // patientId -> { first EINS request day, latest EINS request id }
  const eins = new Map<string, { since: string; requestId: string }>();
  for (const r of requests) {
    if (!r.patientId) continue;
    const a = classifyAttribution({ source: r.source, utm: r.utm });
    if (!a.messweg && a.notMesswegReason !== "plattform_formular") continue;
    const prev = eins.get(r.patientId);
    eins.set(r.patientId, {
      since: prev?.since ?? berlinDay(r.createdAt),
      requestId: r.id,
    });
  }

  const resolved = new Map<string, ReturnType<typeof resolveInterval>>();
  for (const t of treatments) {
    resolved.set(
      t.id,
      t.isActive && !t.archivedAt
        ? resolveInterval({
            mode: t.mode as RetreatmentMode,
            intervalMonths: t.months,
            pvsIntervalDays: intervals.get(t.id)?.intervalDays ?? null,
          })
        : null
    );
  }

  // Visits of EINS patients, from their first EINS request on, in calendar treatments.
  const einsVisits = new Map<string, Visit[]>();
  for (const v of visits) {
    const att = eins.get(v.patientKey);
    if (!att || v.day < att.since || !resolved.get(v.treatmentId)) continue;
    const list = einsVisits.get(v.patientKey);
    if (list) list.push(v);
    else einsVisits.set(v.patientKey, [v]);
  }

  // Full event history of those patients: revenue per appointment + upcoming dates.
  const pvsIdsByPatient = new Map<string, string[]>();
  for (const [pvsId, portalId] of pvsToPortal) {
    if (!einsVisits.has(portalId)) continue;
    const list = pvsIdsByPatient.get(portalId);
    if (list) list.push(pvsId);
    else pvsIdsByPatient.set(portalId, [pvsId]);
  }
  const allPvsIds = [...pvsIdsByPatient.values()].flat();
  const eventsByPatient = new Map<
    string,
    Array<{ id: string; kind: string; occurredAt: Date; payload: unknown }>
  >();
  if (allPvsIds.length > 0) {
    // sql.param keeps the array ONE bound parameter. A bare ${array} inside
    // sql`` is expanded by drizzle 0.36 into ($1, $2, ...), which Postgres
    // rejects ("cannot cast type record to text[]" / "malformed array literal").
    const events = await db
      .select({
        id: schema.pvsEventLog.id,
        kind: schema.pvsEventLog.kind,
        occurredAt: schema.pvsEventLog.occurredAt,
        payload: schema.pvsEventLog.payload,
      })
      .from(schema.pvsEventLog)
      .where(
        and(
          eq(schema.pvsEventLog.clinicId, clinicId),
          sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ANY(${sql.param(allPvsIds)}::text[])`
        )
      )
      .orderBy(asc(schema.pvsEventLog.occurredAt));
    for (const e of events) {
      const pvsId = (e.payload as { pvsPatientId?: unknown }).pvsPatientId;
      const portalId = typeof pvsId === "string" ? pvsToPortal.get(pvsId) : undefined;
      if (!portalId) continue;
      const list = eventsByPatient.get(portalId);
      if (list) list.push(e);
      else eventsByPatient.set(portalId, [e]);
    }
  }

  const desired: DesiredRow[] = [];
  for (const [patientId, patientVisits] of einsVisits) {
    const buckets = foldEvents(eventsByPatient.get(patientId) ?? []);
    const revenueByAppt = new Map<string, number>();
    const upcoming: UpcomingAppointment[] = [];
    for (const b of buckets.byAppt.values()) {
      if (b.invoiceCents > 0) revenueByAppt.set(b.pvsAppointmentId, b.invoiceCents);
      if (
        b.scheduledAt &&
        !b.completedAt &&
        (b.appointmentStatus === "scheduled" || b.appointmentStatus === "checked_in")
      ) {
        upcoming.push({
          day: berlinDay(b.scheduledAt),
          treatmentId: b.treatmentCode ? codeToTreatment.get(b.treatmentCode) ?? null : null,
        });
      }
    }

    const byTreatment = new Map<string, Visit[]>();
    for (const v of patientVisits) {
      const list = byTreatment.get(v.treatmentId);
      if (list) list.push(v);
      else byTreatment.set(v.treatmentId, [v]);
    }
    const requestId = eins.get(patientId)!.requestId;
    for (const [treatmentId, tVisits] of byTreatment) {
      const interval = resolved.get(treatmentId);
      if (!interval) continue;
      const cycles = groupCycles(tVisits).map((c) => {
        const apptIds = new Set(c.visits.map((v) => v.pvsAppointmentId).filter((x): x is string => !!x));
        let cents = 0;
        for (const id of apptIds) cents += revenueByAppt.get(id) ?? 0;
        return { start: c.start, revenueCents: cents > 0 ? cents : null };
      });
      for (const row of deriveCycleRows({ treatmentId, cycles, interval, upcoming, today })) {
        desired.push({ ...row, patientId, treatmentId, requestId });
      }
    }
  }

  // -- 3. Write ------------------------------------------------------------
  const key = (r: { patientId: string; treatmentId: string; cycleOn: string }) =>
    `${r.patientId}|${r.treatmentId}|${r.cycleOn}`;
  const t = schema.retreatmentCycles;

  const { upserted, deleted } = await db.transaction(async (tx) => {
    const existing = await tx
      .select({
        id: t.id,
        patientId: t.patientId,
        treatmentId: t.treatmentId,
        cycleOn: t.cycleOn,
        reminderStatus: t.reminderStatus,
        status: t.status,
      })
      .from(t)
      .where(eq(t.clinicId, clinicId));

    for (let i = 0; i < desired.length; i += WRITE_CHUNK) {
      const chunk = desired.slice(i, i + WRITE_CHUNK);
      await tx
        .insert(t)
        .values(
          chunk.map((r) => ({
            clinicId,
            patientId: r.patientId,
            treatmentId: r.treatmentId,
            requestId: r.requestId,
            cycleOn: r.cycleOn,
            cycleRevenueCents: r.cycleRevenueCents,
            intervalDays: r.intervalDays,
            intervalSource: r.intervalSource,
            dueOn: r.dueOn,
            remindOn: r.remindOn,
            status: r.status,
            returnedOn: r.returnedOn,
            returnedRevenueCents: r.returnedRevenueCents,
            bookedFor: r.bookedFor,
            reminderStatus: r.reminderStatus,
            token: randomBytes(32).toString("hex"),
          }))
        )
        .onConflictDoUpdate({
          target: [t.clinicId, t.patientId, t.treatmentId, t.cycleOn],
          set: {
            requestId: sql`excluded.request_id`,
            cycleRevenueCents: sql`excluded.cycle_revenue_cents`,
            intervalDays: sql`excluded.interval_days`,
            intervalSource: sql`excluded.interval_source`,
            dueOn: sql`excluded.due_on`,
            remindOn: sql`excluded.remind_on`,
            // A Praxis "nicht erinnern" sticks until the patient actually returns.
            status: sql`CASE WHEN retreatment_cycles.status = 'dismissed' AND excluded.status <> 'returned' THEN 'dismissed' ELSE excluded.status END`,
            returnedOn: sql`excluded.returned_on`,
            returnedRevenueCents: sql`excluded.returned_revenue_cents`,
            bookedFor: sql`excluded.booked_for`,
            // Only pending -> not_needed (cycle became history before any reminder).
            reminderStatus: sql`CASE WHEN retreatment_cycles.reminder_status = 'pending' AND excluded.reminder_status = 'not_needed' THEN 'not_needed' ELSE retreatment_cycles.reminder_status END`,
            updatedAt: sql`now()`,
          },
        });
    }

    const wanted = new Set(desired.map(key));
    // Keep rows the Praxis has seen act on: a reminder went out, or the team
    // hid the row ("Ausblenden"). Restoring a hidden row that no longer has a
    // cycle behind it lets the next rebuild remove it.
    const stale = existing
      .filter(
        (e) => !wanted.has(key(e)) && e.reminderStatus !== "sent" && e.status !== "dismissed"
      )
      .map((e) => e.id);
    for (let i = 0; i < stale.length; i += WRITE_CHUNK) {
      await tx.delete(t).where(inArray(t.id, stale.slice(i, i + WRITE_CHUNK)));
    }
    return { upserted: desired.length, deleted: stale.length };
  });

  console.log(
    `[retreatment-refresh] clinic=${clinicId} visits=${visits.length} einsPatients=${einsVisits.size} rows=${upserted} deleted=${deleted}`
  );
}
