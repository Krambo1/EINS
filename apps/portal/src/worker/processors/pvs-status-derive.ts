import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { enqueueInvoiceConversions } from "@/server/ads-conversion-outbox";
import { enqueueKpiRebuild } from "@/server/jobs";
import { scheduleReviewRequest } from "@/server/patient-events";
import { notifyOps } from "@/server/ops-alerts";
import type { PvsEvent } from "@/server/pvs-events";
import { attachRequestsToPatient } from "@/server/request-patient-link";

/**
 * PVS Bridge — request.status + revenue derivation worker.
 *
 * Triggered by every successful applyPvsEvent for a (clinicId, portalPatientId)
 * tuple. Replays the entire event-log history for that patient, groups by
 * `pvsAppointmentId`, and computes the canonical request status + revenue
 * from the events seen.
 *
 * The producer enqueues with pg-boss `singletonKey =
 * ${clinicId}__${portalPatientId}` on a `short`-policy queue, so concurrent
 * enqueues coalesce while one is still queued. Worst case the worker runs once
 * per patient per ~second of event burst, acceptable for a Praxis with
 * thousands of patients.
 *
 * Algorithm per appointment cluster:
 *   has(InvoicePaid) OR has(EncounterCompleted) → 'gewonnen'
 *     (gewonnen only when invoice ≥ 1ct; encounters without invoice → 'behandelt')
 *   has(no_show)                                → 'no_show'
 *   has(checked_in)                             → 'beratung_erschienen'
 *   has(AppointmentCreated)                     → 'termin_vereinbart'
 *   else                                        → unchanged
 *
 * Patient-aggregate:
 *   patients.lifetime_revenue_eur = SUM(InvoicePaid.amountCents / 100)
 *   patients.last_seen_at         = MAX(occurredAt)
 *
 * Cascades:
 *   On status flip, enqueue kpi-rebuild for the affected day(s).
 */

export interface PvsStatusDeriveJob {
  clinicId: string;
  portalPatientId: string;
}

/**
 * P2-3: cascade-attribution alarm thresholds.
 *
 * The derive worker is "PVS gewinnt immer" — events freely overwrite
 * manual edits. That's correct when the event log is clean. It's a
 * silent foot-gun when an upstream linker bug or an operator unlink
 * causes a previously-won request to suddenly read as "no longer won".
 * The alarm holds the change in the dashboard_alerts queue instead of
 * applying silently so an operator can confirm.
 *
 * Triggers:
 *   1. Status downgrade: current = 'gewonnen' AND derived ≠ 'gewonnen'.
 *      The downgrade case is the dangerous one — once a Praxis sees
 *      "Maria Müller won €4,800" in a report and we silently take that
 *      back three weeks later, trust evaporates.
 *   2. Lifetime revenue swing: |new - old| / max(old, 1) > 0.20 in a
 *      single derive run. €1 → €100 is fine (linker just landed an old
 *      invoice); €5,000 → €4,000 is a 20% drop and almost certainly
 *      means the linker absorbed a different patient that wasn't this
 *      one.
 *
 * Ads-conversion fanout gate:
 *   If the request's click id (fbclid/gclid) is older than 90 days
 *   *and* the ad campaign/adset associated with that click hasn't seen
 *   any recent activity, hold the conversion until an operator
 *   confirms. Most platform conversion APIs reject clicks older than
 *   90 days outright, so without this gate we'd fire and burn the
 *   request's API quota with no upside.
 */
const REVENUE_SWING_ALARM_RATIO = 0.20;
const STALE_CLICK_ID_DAYS = 90;

interface AppointmentBuckets {
  /** Keyed by pvsAppointmentId. */
  byAppt: Map<string, AppointmentBucket>;
  invoiceTotalsCents: number;
  minOccurredAt: Date | null;
  maxOccurredAt: Date | null;
  /** True if at least one PatientMerged event was seen. */
  hadMerge: boolean;
  /**
   * M-D6 defense in depth: the distinct CONTINUOUS bridge sources whose
   * InvoicePaid events were counted into the totals (csv_upload / n8n_custom
   * excluded — an operator backfill next to a live adapter is legitimate).
   * Two or more here means two ingest paths delivered billing data for the
   * same patient despite the applyPvsEvent billing-authority gate (historic
   * rows from before 0067, or an operator enabling both paths at once) —
   * processPvsStatusDerive raises a dashboard alert. Detection only: the
   * fold does NOT suppress either side, because it cannot know which rows
   * are the duplicates.
   */
  revenueSources: Set<string>;
}

/** Mirror of the universal-source carve-out in pvs-events.ts
 *  (isContinuousPvsSource). Kept local: importing the server module here
 *  would pull "server-only" plus the pg-boss job chain into the worker. */
const UNIVERSAL_PVS_SOURCES = new Set(["csv_upload", "n8n_custom"]);

interface InvoiceEvent {
  /** pvs_event_log row id of the InvoicePaid event — outbox dedup key. */
  eventLogId: string;
  amountCents: number;
  /** Pass 2: amountCents minus this invoice's (clamped) refunds. The ads
   *  fanout sends this, and never a zero or fully refunded invoice. */
  netCents: number;
  paidAt: Date;
  /** Phase 11: the invoice's currency (EUR/CHF), threaded to the ads outbox. */
  currency?: "EUR" | "CHF";
}

export interface AppointmentBucket {
  /** The PVS appointment id, or `synthetic:<source>::<invoice>` for a
   *  synthetic bucket (see `synthetic`). */
  pvsAppointmentId: string;
  /**
   * Pass 2: true for an invoice that carries no appointment and no resolvable
   * encounter (the normal case for Honorar CSV exports). Before pass 2 such
   * revenue only reached the patient total, never a lead, a dashboard number
   * or an ads conversion. A synthetic bucket is attributed like an
   * appointment (to the patient's lead that existed at the payment date) but
   * never becomes the request's pvs_appointment_id and contributes a status
   * only through its money (gewonnen when > 0).
   */
  synthetic: boolean;
  scheduledAt: Date | null;
  treatmentCode: string | null;
  treatmentLabel: string | null;
  locationCode: string | null;
  locationLabel: string | null;
  bemerkung: string | null;
  pvsEncounterId: string | null;
  completedAt: Date | null;
  noShowAt: Date | null;
  appointmentStatus:
    | "scheduled"
    | "checked_in"
    | "completed"
    | "no_show"
    | "cancelled";
  invoiceCents: number;
  /** Pass 2: refunds netted against this bucket's invoices (each invoice's
   *  refunds clamped at its paid amount). Lets a full refund be told apart
   *  from "no payment ever" when a gewonnen lead would be downgraded. */
  refundedCents: number;
  earliestInvoiceAt: Date | null;
  /**
   * One entry per InvoicePaid event tied to this appointment. Carried
   * separately from `invoiceCents` so the ads-conversion outbox can emit
   * one Meta CAPI Purchase + one Google OCI upload per payment (a deal
   * with installments produces multiple invoices).
   */
  invoiceEvents: InvoiceEvent[];
}

export async function processPvsStatusDerive(
  job: PvsStatusDeriveJob
): Promise<void> {
  const { clinicId, portalPatientId } = job;
  // Pass 2: stamped on the patient at the end (pvs_derived_at). Captured
  // BEFORE the events are read, so an event ingested while this run is busy
  // still counts as newer and pvs-reconcile re-derives the patient.
  const derivedAt = new Date();

  // 1) Find the set of PVS patient ids that map to this portal patient.
  //    (Patient merges can result in multiple pvs ids → one portal patient.)
  const mapRows = await db
    .select({ pvsPatientId: schema.pvsPatientMap.pvsPatientId })
    .from(schema.pvsPatientMap)
    .where(
      and(
        eq(schema.pvsPatientMap.clinicId, clinicId),
        eq(schema.pvsPatientMap.portalPatientId, portalPatientId)
      )
    );
  // Pass 2: no early return. A patient whose last PVS id was re-pointed to
  // another portal patient (fuzzy-link fix, manual resolve) has no map rows
  // left, but still carries the lifetime revenue and the lead revenue derived
  // from that PVS id. Folding zero events resets both (with the usual
  // alarms) instead of double counting the money on two patients.
  const pvsPatientIds = mapRows.map((r) => r.pvsPatientId);

  // 2) Pull the full event-log history for these PVS ids, ordered by
  //    occurredAt ASC so the fold below sees events in temporal order.
  //
  //    The payload->>'pvsPatientId' index (created in 0022) makes this
  //    fast even for big partitions.
  //
  //    The array MUST go through `sql.param(...)`: drizzle 0.36 expands a
  //    bare JS array inside sql`` into a row tuple `($1, $2, ...)`, which
  //    Postgres rejects ("malformed array literal" with one id, "cannot cast
  //    type record to text[]" with two or more). `sql.param` binds the whole
  //    array as ONE parameter; the `::text[]` cast then gives `ANY($1)` a
  //    typed RHS. Guarded by src/db/sql-array-param.test.ts.
  const events = pvsPatientIds.length === 0 ? [] : await db
    .select({
      id: schema.pvsEventLog.id,
      kind: schema.pvsEventLog.kind,
      occurredAt: schema.pvsEventLog.occurredAt,
      ingestedAt: schema.pvsEventLog.ingestedAt,
      payload: schema.pvsEventLog.payload,
    })
    .from(schema.pvsEventLog)
    .where(
      and(
        eq(schema.pvsEventLog.clinicId, clinicId),
        sql`${schema.pvsEventLog.payload}->>'pvsPatientId' = ANY(${sql.param(pvsPatientIds)}::text[])`
      )
    )
    .orderBy(asc(schema.pvsEventLog.occurredAt));

  // Pass 2: attach this PVS patient's open Anfragen (same email, or same
  // phone and name) BEFORE the requests are read below. Nothing else ever
  // set requests.patient_id, so without this no Anfrage got PVS status or
  // revenue. The earliest non-PatientUpserted event tells an existing patient
  // from one the Anfrage brought (first-touch source). Best-effort: a failure
  // here must not stop the derive itself.
  if (pvsPatientIds.length > 0) {
    let earliestActivity: Date | null = null;
    for (const e of events) {
      if (e.kind === "PatientUpserted") continue;
      if (!earliestActivity || e.occurredAt < earliestActivity) earliestActivity = e.occurredAt;
    }
    try {
      await attachRequestsToPatient(clinicId, portalPatientId, earliestActivity);
    } catch (err) {
      console.warn(
        "[pvs-status-derive] attaching Anfragen failed",
        JSON.stringify({ clinicId, portalPatientId, error: String(err) })
      );
    }
  }

  // 3) Fold events into per-appointment buckets + patient-level aggregates.
  const buckets = foldEvents(events);

  // M-D6 defense in depth: the applyPvsEvent billing-authority gate should
  // make it impossible for two continuous sources to deliver billing data for
  // one clinic. If the fold still counted revenue from two or more (historic
  // rows from before 0067, or an operator enabling both paths), the totals
  // below are likely inflated — surface it instead of failing silently. We do
  // NOT suppress either side here: the fold cannot know which rows are the
  // duplicates, and a wrong guess would be worse than a loud alert.
  if (buckets.revenueSources.size >= 2) {
    await raiseDualPathRevenueAlarm({
      clinicId,
      portalPatientId,
      sources: Array.from(buckets.revenueSources),
    });
  }

  // P2-3: snapshot the patient's current lifetime revenue BEFORE
  // updates, so applyAppointmentBuckets + the patient-aggregate update
  // can detect a >20% swing and raise an anomaly alert instead of
  // applying silently.
  const [priorPatient] = await db
    .select({
      lifetimeRevenueEur: schema.patients.lifetimeRevenueEur,
    })
    .from(schema.patients)
    .where(eq(schema.patients.id, portalPatientId))
    .limit(1);
  const priorLifetimeCents = priorPatient
    ? Math.round(parseFloat(priorPatient.lifetimeRevenueEur) * 100)
    : 0;

  // 4) Apply changes per appointment.
  const fanoutFailures = await applyAppointmentBuckets(
    clinicId,
    portalPatientId,
    buckets
  );

  // 5) Update patient aggregate. P2-3: raise an anomaly alert when the
  // lifetime revenue would swing by more than the threshold. We STILL
  // apply the update — the alert is informational rather than blocking
  // because (a) the request-level status downgrade has already been
  // detected per-appointment in applyToRequest, and (b) refusing to
  // update the patient aggregate while leaving requests updated would
  // produce an inconsistent state that's worse than the silent change
  // we're flagging.
  if (
    buckets.invoiceTotalsCents !== priorLifetimeCents &&
    revenueSwingExceedsThreshold(
      priorLifetimeCents,
      buckets.invoiceTotalsCents
    )
  ) {
    await raiseRevenueSwingAlarm({
      clinicId,
      portalPatientId,
      priorCents: priorLifetimeCents,
      newCents: buckets.invoiceTotalsCents,
    });
  }
  // occurredAt can be future-dated (AppointmentCreated = scheduled time);
  // clamp it to "now" wherever it is read as past activity (finding 8).
  const now = new Date();
  await db
    .update(schema.patients)
    .set({
      lifetimeRevenueEur: (buckets.invoiceTotalsCents / 100).toFixed(2),
      // No events (re-pointed away): keep the last real activity.
      lastSeenAt: buckets.maxOccurredAt
        ? clampActivityTimestamp(buckets.maxOccurredAt, now)
        : undefined,
      // Pass 2: not stamped when an ads-outbox insert failed, so the
      // pvs-reconcile stale-derive scan re-derives this patient as well.
      pvsDerivedAt: fanoutFailures === 0 ? derivedAt : undefined,
    })
    .where(eq(schema.patients.id, portalPatientId));

  // 6) Cascade KPI rebuild for the date range covered by these events.
  if (buckets.minOccurredAt && buckets.maxOccurredAt) {
    const range = clampKpiRebuildRange(
      buckets.minOccurredAt,
      buckets.maxOccurredAt,
      now
    );
    if (range) await enqueueKpiRebuild(clinicId, range.from, range.to);
  }

  // Pass 2: an outbox insert that failed used to be logged and forgotten
  // ("reconcile will retry", which it never did), so that Purchase was lost.
  // Every request write above is done and idempotent; failing the job now
  // makes pg-boss retry it, and the outbox UNIQUE keys absorb the replay.
  if (fanoutFailures > 0) {
    throw new Error(
      `pvs-status-derive: ${fanoutFailures} ads-outbox insert(s) failed for patient ${portalPatientId}, retrying`
    );
  }
}

/**
 * P2-3: a swing is alarming when:
 *   - prior = 0 and new ≥ €100 (suddenly attributing a big invoice to a
 *     patient who had no prior revenue suggests a linker landed an old
 *     event on the wrong person), OR
 *   - |Δ| / max(prior, 1) > REVENUE_SWING_ALARM_RATIO.
 *
 * The €100 floor for prior=0 keeps us from spamming alerts on every
 * normal "first invoice ever for this patient" event.
 */
export function revenueSwingExceedsThreshold(
  priorCents: number,
  newCents: number
): boolean {
  if (priorCents === 0 && newCents === 0) return false;
  if (priorCents === 0) {
    return newCents >= 10_000; // €100
  }
  const ratio = Math.abs(newCents - priorCents) / priorCents;
  return ratio > REVENUE_SWING_ALARM_RATIO;
}

/**
 * Review finding 8: AppointmentCreated carries occurredAt = the appointment's
 * scheduled time, which is normally in the FUTURE. foldEvents folds that into
 * maxOccurredAt, so without clamping a single future booking pushes the
 * patient's lastSeenAt into the future ("last seen in 3 weeks") and makes the
 * KPI rebuild span dates that have not happened yet.
 *
 * We deliberately leave the event-log occurredAt untouched (it is part of the
 * dedup + partition key and must stay stable per appointment, see
 * tomedo.yaml). Instead we clamp to "now" at the two places where occurredAt
 * is interpreted as PAST ACTIVITY.
 */

/** lastSeenAt = the most recent PAST activity. A future booking is not
 *  activity yet, so clamp it to `now`; null (no events) also collapses to now. */
export function clampActivityTimestamp(
  maxOccurredAt: Date | null,
  now: Date
): Date {
  if (!maxOccurredAt) return now;
  return maxOccurredAt.getTime() > now.getTime() ? now : maxOccurredAt;
}

/** KPI rebuild range. There are no KPIs in the future, so the upper bound is
 *  clamped to today. If the whole range is in the future (e.g. the patient's
 *  only event is a future booking), there is nothing past to rebuild -> null. */
export function clampKpiRebuildRange(
  minOccurredAt: Date,
  maxOccurredAt: Date,
  now: Date
): { from: string; to: string } | null {
  const today = now.toISOString().slice(0, 10);
  const from = minOccurredAt.toISOString().slice(0, 10);
  const rawTo = maxOccurredAt.toISOString().slice(0, 10);
  const to = rawTo > today ? today : rawTo;
  if (from > to) return null;
  return { from, to };
}

async function raiseRevenueSwingAlarm(args: {
  clinicId: string;
  portalPatientId: string;
  priorCents: number;
  newCents: number;
}): Promise<void> {
  // dedupe_key buckets re-detections of the SAME swing-on-same-patient
  // until the alert is dismissed. We append a calendar-day suffix so a
  // follow-up swing on a different day produces a separate alert; same-
  // day re-runs (replay, idempotent enqueue) collapse into one row.
  const day = new Date().toISOString().slice(0, 10);
  const dedupeKey = `pvs_revenue_swing:${args.portalPatientId}:${day}`;
  const prior = (args.priorCents / 100).toFixed(2);
  const next = (args.newCents / 100).toFixed(2);
  const delta = (args.newCents - args.priorCents) / 100;
  const direction = delta < 0 ? "↓" : "↑";
  try {
    await db
      .insert(schema.dashboardAlerts)
      .values({
        clinicId: args.clinicId,
        kind: "pvs_revenue_swing",
        severity: "high",
        title: `PVS: ungewöhnliche Revenue-Verschiebung (${direction} ${Math.abs(delta).toFixed(2)} €)`,
        body: `Ein PVS-Sync hat die Lifetime-Revenue eines Patienten von ${prior} € auf ${next} € geändert (>20 % Sprung in einem Lauf). Häufige Ursache: ein falscher Fuzzy-Link hat einen anderen Patienten in dieses Konto gemerged. Bitte den Patienten in der PVS-Inbox prüfen und ggf. via pvs-reconcile unlink + replay-events korrigieren.`,
        actionSteps: [
          "Patientenakte in der PVS öffnen und Rechnungs-Historie prüfen.",
          "Bei Fehlattribution: pnpm pvs:reconcile unlink mit --reason 'wrong-fuzzy-match' ausführen.",
          "Anschließend pnpm pvs:reconcile replay-events für das Fenster der betroffenen Rechnungen.",
        ],
        metric: "pvs_lifetime_revenue_eur",
        baselineValue: prior,
        observedValue: next,
        dedupeKey,
      })
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          observedValue: next,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    // Best-effort: alarm-write failure must NOT cascade into the
    // patient/request updates above. Log loudly so we know the surface
    // is broken without blocking ingest.
    console.error(
      `[pvs-status-derive] revenue-swing alarm write failed (clinic=${args.clinicId}, patient=${args.portalPatientId}):`,
      err
    );
  }
}

/**
 * M-D6: two continuous ingest paths contributed counted revenue to the same
 * patient. Dedupe key is per patient WITHOUT a day suffix — a standing data
 * condition, not an incident stream; re-detections refresh updated_at.
 * Best-effort like the other alarms.
 */
async function raiseDualPathRevenueAlarm(args: {
  clinicId: string;
  portalPatientId: string;
  sources: string[];
}): Promise<void> {
  const dedupeKey = `pvs_dual_path_revenue:${args.portalPatientId}`;
  const sourceList = args.sources.join(", ");
  const alertBody = `Für einen Patienten wurden Rechnungs-Ereignisse aus mehreren Anbindungen gezählt (${sourceList}). Wenn beide Pfade dieselbe PVS abbilden, sind Lifetime-Revenue und der Umsatz der zugehörigen Anfragen wahrscheinlich doppelt gezählt. Das Portal nimmt neue Rechnungsdaten nur noch aus der führenden Quelle an; die bereits eingelesenen Ereignisse müssen bereinigt werden.`;
  try {
    await db
      .insert(schema.dashboardAlerts)
      .values({
        clinicId: args.clinicId,
        kind: "pvs_dual_path_revenue",
        severity: "high",
        title: `PVS: Umsätze aus zwei Datenpfaden bei einem Patienten (${sourceList})`,
        body: alertBody,
        actionSteps: [
          "Rechnungs-Historie des Patienten in der PVS mit den Portal-Ereignissen vergleichen.",
          "Doppelte Ereignisse des nicht führenden Pfads via pnpm pvs:reconcile bereinigen (unlink + replay-events).",
          "Prüfen, dass billing_enabled in pvs_link_source nur für die führende Quelle aktiv ist.",
        ],
        metric: "pvs_dual_path_revenue_sources",
        // dashboard_alerts.observed_value is numeric(14,4): a source-name
        // string raised 22P02 and the alert was never written. The sources
        // are in the title/body instead.
        observedValue: null,
        dedupeKey,
      })
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          body: alertBody,
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error(
      `[pvs-status-derive] dual-path revenue alarm write failed (clinic=${args.clinicId}, patient=${args.portalPatientId}):`,
      err
    );
  }
  // Probably double-counted revenue: page EINS (rate-limited per clinic).
  await notifyOps({
    clinicId: args.clinicId,
    kind: "pvs_dual_path_revenue",
    severity: "high",
    title: `PVS: Umsätze aus zwei Datenpfaden (${sourceList})`,
    body: alertBody,
  });
}

async function raiseStatusDowngradeAlarm(args: {
  clinicId: string;
  requestId: string;
  pvsAppointmentId: string;
  fromStatus: string;
  toStatus: string;
  invoiceCents: number;
}): Promise<void> {
  // dedupe per request+day, same rationale as the revenue alarm.
  const day = new Date().toISOString().slice(0, 10);
  const dedupeKey = `pvs_status_downgrade:${args.requestId}:${day}`;
  try {
    await db
      .insert(schema.dashboardAlerts)
      .values({
        clinicId: args.clinicId,
        kind: "pvs_status_downgrade",
        severity: "extreme",
        title: `PVS: gewonnener Lead würde zurückgestuft (${args.fromStatus} → ${args.toStatus})`,
        body: `Ein PVS-Sync würde einen bereits als 'gewonnen' markierten Lead auf '${args.toStatus}' zurücksetzen (Termin ${args.pvsAppointmentId}). Häufige Ursache: ein Stornierungs- oder Merge-Event ist nachträglich im PVS verarbeitet worden. Der Status bleibt vorerst bei 'gewonnen', bis dies bestätigt wird.`,
        actionSteps: [
          "PVS-Akte des Patienten öffnen und Rechnungs-/Termin-Historie prüfen.",
          "Bei legitimer Rückstufung: Status manuell auf 'verloren' setzen oder Praxis-seitig Stornierung bestätigen.",
          "Bei Fehlattribution: pnpm pvs:reconcile unlink mit Begründung dokumentieren.",
        ],
        metric: "pvs_status_downgrade_cents",
        observedValue: (args.invoiceCents / 100).toFixed(2),
        dedupeKey,
      })
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          observedValue: (args.invoiceCents / 100).toFixed(2),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error(
      `[pvs-status-derive] status-downgrade alarm write failed (clinic=${args.clinicId}, request=${args.requestId}):`,
      err
    );
  }
}

async function raiseStaleClickIdAlarm(args: {
  clinicId: string;
  requestId: string;
  clickCreatedAt: Date;
  valueEur: number;
}): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  const dedupeKey = `pvs_stale_click_conversion:${args.requestId}:${day}`;
  const ageDays = Math.floor(
    (Date.now() - args.clickCreatedAt.getTime()) / (24 * 60 * 60 * 1000)
  );
  try {
    await db
      .insert(schema.dashboardAlerts)
      .values({
        clinicId: args.clinicId,
        kind: "pvs_stale_click_conversion",
        severity: "warn",
        title: `Conversion gegen alten Klick angehalten (${ageDays} Tage)`,
        body: `Eine Rechnung über ${args.valueEur.toFixed(2)} EUR würde an einen Klick weitergegeben, dessen fbclid/gclid älter als ${STALE_CLICK_ID_DAYS} Tage ist. Meta und Google verwerfen solche Conversion-Uploads sowieso, daher wird kein Outbox-Eintrag erzeugt. Wenn die Zuordnung trotzdem gewünscht ist, muss ein Operator den Outbox-Eintrag manuell anlegen.`,
        actionSteps: [
          "Plausibilität prüfen: gehört diese Rechnung wirklich zu dieser Anfrage?",
          "Falls ja: Outbox-Eintrag manuell anlegen (DB direkt) und Conversion-Worker triggern.",
          "Falls nein: keine Aktion nötig — Lead wurde organisch.",
        ],
        metric: "pvs_stale_click_age_days",
        observedValue: ageDays.toString(),
        dedupeKey,
      })
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          observedValue: ageDays.toString(),
          updatedAt: new Date(),
        },
      });
  } catch (err) {
    console.error(
      `[pvs-status-derive] stale-click alarm write failed (clinic=${args.clinicId}, request=${args.requestId}):`,
      err
    );
  }
}

// ---------------------------------------------------------------
// Fold events → buckets
// ---------------------------------------------------------------

export function foldEvents(
  events: Array<{
    id: string;
    kind: string;
    occurredAt: Date;
    /** Insert time (Postgres now() = transaction start). Tie-break for
     *  invoice/refund rows with an equal occurredAt; optional so callers and
     *  tests that predate it keep working. */
    ingestedAt?: Date | null;
    payload: unknown;
  }>
): AppointmentBuckets {
  const byAppt = new Map<string, AppointmentBucket>();
  let invoiceTotalsCents = 0;
  let minAt: Date | null = null;
  let maxAt: Date | null = null;
  let hadMerge = false;

  // #9: an appt-less invoice that carries a pvsEncounterId can still be
  // attributed PRECISELY (not guessed) by bridging through the encounter to
  // its appointment. Pre-scan EncounterCompleted first, because an InvoicePaid
  // may sort before the encounter that links it (occurredAt is paidAt vs
  // completedAt). Truly appt-less, no-encounter invoices stay in patient
  // lifetime revenue only and are never guessed onto a request.
  const encounterToAppt = new Map<string, string>();
  for (const e of events) {
    const p = e.payload as PvsEvent;
    if (
      p.kind === "EncounterCompleted" &&
      p.pvsEncounterId &&
      p.pvsAppointmentId
    ) {
      encounterToAppt.set(p.pvsEncounterId, p.pvsAppointmentId);
    }
  }

  // H4: re-emissions of the SAME logical invoice (corrected payment date on
  // re-export, wall-clock occurredAt after watcher-state loss, FHIR webhook
  // redelivery) land as SEPARATE pvs_event_log rows, because occurredAt is part
  // of the dedup key. Summing InvoicePaid per row would double-count revenue,
  // which backs the Garantie, so we dedup per invoice here: an invoice is
  // counted ONCE, using the amount from the row with the LATEST occurredAt (a
  // re-emission with a corrected amount wins). pvsInvoiceId is only unique per
  // source system, so the key is scoped by bridgeSource. Rows without a
  // pvsInvoiceId (defensive: the schema requires one) stay unique, summed per
  // row. We collect during the loop and reconcile after it, keeping the ASC
  // iteration = "last write wins = latest occurredAt" invariant simple.
  interface PaidEntry {
    amountCents: number;
    apptId: string | null;
    eventLogId: string;
    ingestedAt: Date | null;
    paidAt: Date;
    occurredAt: Date;
    sourceRevision: number | null;
    currency?: "EUR" | "CHF";
    /** M-D6: provenance of the counted payment, for dual-path detection. */
    bridgeSource: string | undefined;
  }
  interface RefundEntry {
    refundedAmountCents: number;
    pvsInvoiceId: string | null;
    bridgeSource: string | undefined;
    occurredAt: Date;
    sourceRevision: number | null;
    eventLogId: string;
    ingestedAt: Date | null;
  }
  const paidByInvoice = new Map<string, PaidEntry>();
  const unkeyedPaid: PaidEntry[] = [];
  // Pass 2: highest amount any version of an invoice ever carried. CSV and
  // DB exports have no refund document: a storno or credit shows up as the
  // same invoice re-emitted with a lower amount (0 for a full storno). The
  // latest version already sets the revenue; the drop is recorded as
  // refunded so a lead whose invoice went to 0 is downgraded like a refund
  // instead of being held at gewonnen with an unexplained-drop alarm.
  const peakPaidByInvoice = new Map<string, number>();
  // Pass 2 (open item 1): per invoice key, one entry per refund document
  // (pvsRefundId; "" for producers that send none). Versions of one refund
  // document are latest-wins; distinct documents are SUMMED, so two partial
  // credit notes of one invoice both count instead of the later replacing
  // the earlier.
  const refundsByInvoice = new Map<string, Map<string, RefundEntry>>();
  let unkeyedRefunds = 0;
  const invoiceKey = (bridgeSource: string | undefined, pvsInvoiceId: string) =>
    `${bridgeSource ?? ""}::${pvsInvoiceId}`;
  // Pass 2: a producer revision (CSV invoice-book revision, DB modified_at)
  // decides first when both versions carry one: arrival order is not
  // production order (the agent retries a failed row behind newer ones), and
  // a corrected payment date may be EARLIER than the original.
  // Otherwise latest occurredAt wins; on a tie the later INSERT wins
  // (ingestedAt), so a corrected re-export with the same paidAt replaces the
  // stale amount. ingestedAt is the transaction start time, so two rows
  // inserted in the same transaction still tie; the event log id (a random
  // UUID) is only the last-resort deterministic tie-break, not "later wins".
  const isLaterEntry = (
    a: { occurredAt: Date; eventLogId: string; ingestedAt: Date | null; sourceRevision: number | null },
    b: { occurredAt: Date; eventLogId: string; ingestedAt: Date | null; sourceRevision: number | null }
  ): boolean => {
    if (
      a.sourceRevision !== null &&
      b.sourceRevision !== null &&
      a.sourceRevision !== b.sourceRevision
    ) {
      return a.sourceRevision > b.sourceRevision;
    }
    const d = a.occurredAt.getTime() - b.occurredAt.getTime();
    if (d !== 0) return d > 0;
    if (a.ingestedAt && b.ingestedAt) {
      const i = a.ingestedAt.getTime() - b.ingestedAt.getTime();
      if (i !== 0) return i > 0;
    }
    return a.eventLogId >= b.eventLogId;
  };

  const ensure = (id: string, synthetic = false): AppointmentBucket => {
    let b = byAppt.get(id);
    if (!b) {
      b = {
        pvsAppointmentId: id,
        synthetic,
        scheduledAt: null,
        treatmentCode: null,
        treatmentLabel: null,
        locationCode: null,
        locationLabel: null,
        bemerkung: null,
        pvsEncounterId: null,
        completedAt: null,
        noShowAt: null,
        appointmentStatus: "scheduled",
        invoiceCents: 0,
        refundedCents: 0,
        earliestInvoiceAt: null,
        invoiceEvents: [],
      };
      byAppt.set(id, b);
    }
    return b;
  };

  for (const e of events) {
    if (!minAt || e.occurredAt < minAt) minAt = e.occurredAt;
    if (!maxAt || e.occurredAt > maxAt) maxAt = e.occurredAt;

    const payload = e.payload as PvsEvent;
    switch (payload.kind) {
      case "AppointmentCreated": {
        const b = ensure(payload.pvsAppointmentId);
        b.scheduledAt = new Date(payload.scheduledAt);
        b.treatmentCode = payload.treatmentCode ?? b.treatmentCode;
        b.treatmentLabel = payload.treatmentLabel ?? b.treatmentLabel;
        b.locationCode = payload.locationCode ?? b.locationCode;
        b.locationLabel = payload.locationLabel ?? b.locationLabel;
        b.bemerkung = payload.bemerkung ?? b.bemerkung;
        break;
      }
      case "AppointmentStatusChanged": {
        const b = ensure(payload.pvsAppointmentId);
        // Status changes are time-ordered (we iterate ASC), so the latest
        // wins implicitly.
        b.appointmentStatus = payload.newStatus;
        // Pass 2: a no-show is a STATE, not a one-way flag. A receptionist's
        // mis-click corrected to checked_in (or a later completion) used to
        // keep the lead at no_show forever.
        if (payload.newStatus === "no_show") {
          if (!b.noShowAt) b.noShowAt = e.occurredAt;
        } else {
          b.noShowAt = null;
        }
        break;
      }
      case "AppointmentCancelled": {
        const b = ensure(payload.pvsAppointmentId);
        b.appointmentStatus = "cancelled";
        b.noShowAt = null;
        break;
      }
      case "EncounterCompleted": {
        if (payload.pvsAppointmentId) {
          const b = ensure(payload.pvsAppointmentId);
          b.pvsEncounterId = payload.pvsEncounterId;
          b.completedAt = new Date(payload.completedAt);
          b.appointmentStatus = "completed";
          b.noShowAt = null;
          b.treatmentCode = payload.treatmentCode ?? b.treatmentCode;
          b.treatmentLabel = payload.treatmentLabel ?? b.treatmentLabel;
        }
        break;
      }
      case "InvoicePaid": {
        // #9: prefer the explicit appointment; otherwise bridge via the
        // encounter. No appointment and no resolvable encounter means the
        // payment counts toward patient lifetime revenue but is never guessed
        // onto a lead.
        const apptId =
          payload.pvsAppointmentId ??
          (payload.pvsEncounterId
            ? encounterToAppt.get(payload.pvsEncounterId)
            : undefined) ??
          null;
        // H4: collect (don't accumulate yet). For a keyed invoice the map keeps
        // the latest-occurredAt row (ASC iteration => last write wins); unkeyed
        // rows stay unique.
        const entry: PaidEntry = {
          amountCents: payload.amountCents,
          apptId,
          eventLogId: e.id,
          ingestedAt: e.ingestedAt ?? null,
          paidAt: new Date(payload.paidAt),
          occurredAt: e.occurredAt,
          sourceRevision: payload.sourceRevision ?? null,
          currency: payload.currency,
          bridgeSource: payload.bridgeSource,
        };
        if (payload.pvsInvoiceId) {
          const key = invoiceKey(payload.bridgeSource, payload.pvsInvoiceId);
          peakPaidByInvoice.set(
            key,
            Math.max(peakPaidByInvoice.get(key) ?? 0, payload.amountCents)
          );
          const prev = paidByInvoice.get(key);
          // Latest occurredAt wins; on an equal occurredAt (corrected
          // re-export with the same paidAt) the later insert wins, see
          // isLaterEntry.
          if (!prev || isLaterEntry(entry, prev)) {
            paidByInvoice.set(key, entry);
          }
        } else {
          unkeyedPaid.push(entry);
        }
        break;
      }
      case "InvoiceRefunded": {
        // #10 + H4: money out. Collect and dedup the same way as InvoicePaid,
        // so a re-emitted refund is netted once. Reconciled after the loop:
        // subtract from the patient total and from the bucket the invoice's
        // revenue landed on, so request-level revenue and the gewonnen status
        // net down. The ads-platform refund/adjustment is a follow-up; v1
        // corrects the dashboard numbers.
        const entry: RefundEntry = {
          refundedAmountCents: payload.refundedAmountCents,
          pvsInvoiceId: payload.pvsInvoiceId ?? null,
          bridgeSource: payload.bridgeSource,
          occurredAt: e.occurredAt,
          sourceRevision: payload.sourceRevision ?? null,
          eventLogId: e.id,
          ingestedAt: e.ingestedAt ?? null,
        };
        if (payload.pvsInvoiceId) {
          const key = invoiceKey(payload.bridgeSource, payload.pvsInvoiceId);
          let docs = refundsByInvoice.get(key);
          if (!docs) {
            docs = new Map();
            refundsByInvoice.set(key, docs);
          }
          const docKey = payload.pvsRefundId ?? "";
          const prev = docs.get(docKey);
          if (!prev || isLaterEntry(entry, prev)) {
            docs.set(docKey, entry);
          }
        } else {
          unkeyedRefunds++;
        }
        break;
      }
      case "PatientMerged": {
        hadMerge = true;
        break;
      }
      // PatientUpserted + RecallScheduled don't drive appointment buckets.
      default:
        break;
    }
  }

  // H4: apply the deduped invoices. Sort the paid entries by occurredAt ASC so
  // earliestInvoiceAt and invoiceEvents keep the ordering they had when this was
  // accumulated inline in the loop.
  const paidEntries = [...paidByInvoice.values(), ...unkeyedPaid].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );
  // M-D6: track which continuous sources contributed counted revenue. Two or
  // more means a dual ingest path slipped past the billing-authority gate.
  const revenueSources = new Set<string>();
  for (const paid of paidEntries) {
    if (paid.bridgeSource && !UNIVERSAL_PVS_SOURCES.has(paid.bridgeSource)) {
      revenueSources.add(paid.bridgeSource);
    }
  }
  // #10: index each (deduped) invoice by the bucket its revenue landed on, so
  // an InvoiceRefunded keyed only by pvsInvoiceId nets that same bucket.
  const paidIndex = new Map<string, { bucket: AppointmentBucket; paid: PaidEntry; inv: InvoiceEvent }>();
  const keyOfPaid = new Map<PaidEntry, string>();
  for (const [key, paid] of paidByInvoice) keyOfPaid.set(paid, key);
  for (const paid of paidEntries) {
    invoiceTotalsCents += paid.amountCents;
    const key = keyOfPaid.get(paid);
    // Pass 2: an invoice with no appointment and no resolvable encounter gets
    // its own synthetic bucket instead of reaching the patient total only.
    const b = paid.apptId
      ? ensure(paid.apptId)
      : ensure(`synthetic:${key ?? `row:${paid.eventLogId}`}`, true);
    b.invoiceCents += paid.amountCents;
    if (!b.earliestInvoiceAt || paid.paidAt < b.earliestInvoiceAt) {
      b.earliestInvoiceAt = paid.paidAt;
    }
    const inv: InvoiceEvent = {
      eventLogId: paid.eventLogId,
      amountCents: paid.amountCents,
      netCents: paid.amountCents,
      paidAt: paid.paidAt,
      currency: paid.currency,
    };
    b.invoiceEvents.push(inv);
    if (key) {
      paidIndex.set(key, { bucket: b, paid, inv });
      const drop = (peakPaidByInvoice.get(key) ?? 0) - paid.amountCents;
      if (drop > 0) b.refundedCents += drop;
    }
  }
  // Refunds only net a KNOWN paid invoice of the same bridgeSource::pvsInvoiceId.
  // A refund whose invoice has no folded InvoicePaid (invoice from before the
  // agent cutover, or paid through a different source) is an orphan: counted
  // and logged, never subtracted from revenue (B2).
  // Pass 2: distinct refund documents of one invoice are summed, and the sum
  // is clamped at that invoice's paid amount, so refunds of one invoice can
  // never eat another invoice's revenue.
  let orphanRefunds = unkeyedRefunds;
  for (const [key, docs] of refundsByInvoice) {
    const hit = paidIndex.get(key);
    if (!hit) {
      orphanRefunds += docs.size;
      continue;
    }
    let refunded = 0;
    for (const [docKey, doc] of docs) {
      // Pass 2 (verifier): a refund without its own document id (CSV: the
      // net of one export) is superseded by a LATER version of the invoice,
      // which is again a net state and already contains it. Subtracting it
      // again counted an overlapping export's credit twice. A credit note
      // with its own id is a separate document and always nets.
      if (docKey === "" && isLaterEntry(hit.paid, doc)) continue;
      refunded += doc.refundedAmountCents;
    }
    const applied = Math.min(refunded, hit.paid.amountCents);
    invoiceTotalsCents -= applied;
    hit.bucket.invoiceCents -= applied;
    hit.bucket.refundedCents += applied;
    hit.inv.netCents = hit.paid.amountCents - applied;
  }
  if (orphanRefunds > 0) {
    console.warn(
      `[pvs-status-derive] ${orphanRefunds} orphan InvoiceRefunded event(s) without a matching InvoicePaid ignored`
    );
  }

  // #10: a refund can only drive a total or bucket below zero if we never saw
  // the original payment (e.g. it was attributed to a different pvs id before a
  // merge). Clamp so revenue never reads negative.
  if (invoiceTotalsCents < 0) invoiceTotalsCents = 0;
  for (const b of byAppt.values()) {
    if (b.invoiceCents < 0) b.invoiceCents = 0;
  }

  return {
    byAppt,
    invoiceTotalsCents,
    minOccurredAt: minAt,
    maxOccurredAt: maxAt,
    hadMerge,
    revenueSources,
  };
}

// ---------------------------------------------------------------
// Bucket → requests row update
// ---------------------------------------------------------------

async function applyAppointmentBuckets(
  clinicId: string,
  portalPatientId: string,
  buckets: AppointmentBuckets
): Promise<number> {
  const all = [...buckets.byAppt.values()];
  let fanoutFailures = 0;

  // Pass 2: load the candidate requests once, then attribute every bucket in
  // memory (assignBucketsToRequests) and write ONE aggregate per request.
  // Before, each appointment was matched on its own and a lead could hold
  // only one: once the consultation linked the request, the later treatment
  // appointment (with the actual invoice) found no request and its revenue
  // never reached the lead, the dashboard or the ads conversion.
  const cols = {
    id: schema.requests.id,
    createdAt: schema.requests.createdAt,
    pvsAppointmentId: schema.requests.pvsAppointmentId,
    status: schema.requests.status,
    statusSource: schema.requests.statusSource,
    convertedRevenueEur: schema.requests.convertedRevenueEur,
  };
  const patientRequests = await db
    .select(cols)
    .from(schema.requests)
    .where(
      and(
        eq(schema.requests.clinicId, clinicId),
        eq(schema.requests.patientId, portalPatientId)
      )
    );
  const realApptIds = all.filter((b) => !b.synthetic).map((b) => b.pvsAppointmentId);
  const linkedRequests = realApptIds.length
    ? await db
        .select(cols)
        .from(schema.requests)
        .where(
          and(
            eq(schema.requests.clinicId, clinicId),
            inArray(schema.requests.pvsAppointmentId, realApptIds)
          )
        )
    : [];

  const assigned = assignBucketsToRequests(all, patientRequests, linkedRequests);
  const byId = new Map<string, (typeof patientRequests)[number]>();
  for (const r of [...patientRequests, ...linkedRequests]) byId.set(r.id, r);

  for (const [requestId, reqBuckets] of assigned) {
    const current = byId.get(requestId);
    if (!current) continue;
    const agg = aggregateRequestBuckets(reqBuckets, current.pvsAppointmentId);
    const applied = await applyToRequest(current, agg, clinicId);
    if (!applied) continue;
    fanoutFailures += await fanoutInvoiceConversions(
      clinicId,
      requestId,
      conversionsToSend(reqBuckets)
    );
    for (const bucket of reqBuckets) {
      if (bucket.completedAt) {
        await maybeScheduleReviewForCompletedEncounter({
          clinicId,
          portalPatientId,
          requestId,
          bucket,
        });
      }
    }
  }

  // Pass 2: PVS-derived revenue on a lead that no longer receives any bucket
  // (its PVS patient was re-pointed elsewhere, or a payment now belongs to a
  // newer lead) is stale. Left alone, the same money counted on two leads.
  // convertedRevenueEur of a statusSource='pvs' request is derive-owned, so
  // it is reset to 0; a gewonnen status is NOT taken back silently (P2-3),
  // the downgrade alarm asks the operator instead.
  for (const r of patientRequests) {
    if (assigned.has(r.id) || r.statusSource !== "pvs") continue;
    if (!(toCents(r.convertedRevenueEur) ?? 0)) continue;
    await db
      .update(schema.requests)
      .set({ convertedRevenueEur: "0.00" })
      .where(eq(schema.requests.id, r.id));
    await db.insert(schema.requestActivities).values({
      requestId: r.id,
      actorId: null,
      kind: "status_change",
      body: "PVS: Umsatz entfernt (keine zugeordnete Rechnung mehr)",
      meta: {
        source: "pvs",
        from: r.status,
        to: r.status,
        invoiceCents: 0,
        previousRevenueEur: r.convertedRevenueEur,
      },
    });
    if (r.status === "gewonnen") {
      await raiseStatusDowngradeAlarm({
        clinicId,
        requestId: r.id,
        pvsAppointmentId: r.pvsAppointmentId ?? "ohne Termin",
        fromStatus: r.status,
        toStatus: "unbekannt",
        invoiceCents: 0,
      });
    }
  }
  return fanoutFailures;
}

const ATTACH_SLACK_MS = 24 * 60 * 60 * 1000;

/** Best available "when did this appointment take place" for a bucket. */
function bucketReferenceDate(b: AppointmentBucket): Date | null {
  return b.scheduledAt ?? b.completedAt ?? b.earliestInvoiceAt ?? b.noShowAt;
}

/**
 * True when the bucket's appointment is not older than request.createdAt - 1d.
 * Used only for the heuristic attach path (no pvs_appointment_id link).
 */
export function appointmentIsRecentEnough(
  b: AppointmentBucket,
  requestCreatedAt: Date | null
): boolean {
  if (!requestCreatedAt) return true;
  const ref = bucketReferenceDate(b);
  if (!ref) return false;
  return ref.getTime() >= requestCreatedAt.getTime() - ATTACH_SLACK_MS;
}

/** The request fields attribution needs. */
export interface RequestCandidate {
  id: string;
  createdAt: Date | null;
  pvsAppointmentId: string | null;
  status: string;
}

/**
 * Pass 2: attribute every bucket of one patient to at most one request.
 *
 *   1. A real appointment already linked to a request (requests.pvs_appointment_id)
 *      stays on that request. The link is stable across derive runs, even when
 *      the linked request belongs to another portal patient (re-point history).
 *   2. Otherwise the bucket goes to the patient's LATEST request that already
 *      existed at the bucket's date (createdAt <= reference date). Only when
 *      there is none, a request created within the 1-day slack after it
 *      (createdAt - 1 day <= reference date, the B4 recency guard) qualifies.
 *      A lead created after the treatment did not cause it.
 *   3. No such request: the bucket stays patient-level only (no lead to credit).
 *
 * Spam requests never receive PVS data. Several buckets may land on one
 * request; aggregateRequestBuckets folds them. Pure, for unit tests.
 */
export function assignBucketsToRequests(
  buckets: AppointmentBucket[],
  patientRequests: RequestCandidate[],
  linkedRequests: RequestCandidate[] = []
): Map<string, AppointmentBucket[]> {
  const linkedByAppt = new Map<string, RequestCandidate>();
  for (const r of [...patientRequests, ...linkedRequests]) {
    if (r.pvsAppointmentId) linkedByAppt.set(r.pvsAppointmentId, r);
  }
  // Latest first; a null createdAt sorts last (treated as oldest).
  const candidates = patientRequests
    .filter((r) => r.status !== "spam")
    .sort((a, b) => (b.createdAt?.getTime() ?? -Infinity) - (a.createdAt?.getTime() ?? -Infinity));
  const out = new Map<string, AppointmentBucket[]>();
  const push = (id: string, b: AppointmentBucket) => {
    const list = out.get(id);
    if (list) list.push(b);
    else out.set(id, [b]);
  };
  for (const b of buckets) {
    if (!b.synthetic) {
      const linked = linkedByAppt.get(b.pvsAppointmentId);
      if (linked) {
        push(linked.id, b);
        continue;
      }
    }
    // A lead that existed BEFORE the bucket's date wins over one created in
    // the 1-day slack after it. Otherwise a lead submitted the evening after
    // a payment would take that payment away from the lead that caused it.
    const ref = bucketReferenceDate(b);
    const target =
      candidates.find((r) => !r.createdAt || (ref !== null && r.createdAt.getTime() <= ref.getTime())) ??
      candidates.find((r) => appointmentIsRecentEnough(b, r.createdAt));
    if (target) push(target.id, b);
  }
  return out;
}

export type DerivedStatus =
  | "gewonnen"
  | "behandelt"
  | "no_show"
  | "beratung_erschienen"
  | "termin_vereinbart";

export function deriveStatusForBucket(b: AppointmentBucket): DerivedStatus | null {
  if (b.invoiceCents > 0) return "gewonnen";
  // A synthetic bucket is only money: without a positive amount it says
  // nothing about the lead's stage.
  if (b.synthetic) return null;
  // Pass 2: a PVS that reports completion only as a status change (no
  // EncounterCompleted) still treated the patient.
  if (b.completedAt || b.appointmentStatus === "completed") return "behandelt";
  if (b.appointmentStatus === "no_show") return "no_show";
  if (b.appointmentStatus === "checked_in") return "beratung_erschienen";
  if (b.appointmentStatus === "cancelled") {
    // Cancelled appointments don't drive a request status change beyond
    // termin_vereinbart (which still happened); some clinics want a
    // 'verloren' marker but that's a manual decision.
    return "termin_vereinbart";
  }
  return "termin_vereinbart";
}

/** Pass 2: furthest funnel stage wins when one lead has several appointments.
 *  A no-show ranks lowest: a rebooked appointment after a no-show is
 *  termin_vereinbart again. */
const STATUS_RANK: Record<DerivedStatus, number> = {
  no_show: 1,
  termin_vereinbart: 2,
  beratung_erschienen: 3,
  behandelt: 4,
  gewonnen: 5,
};

export interface RequestAggregate {
  status: DerivedStatus | null;
  /** Net revenue across the request's buckets (after refunds). */
  invoiceCents: number;
  refundedCents: number;
  /** Earliest payment of a bucket that still carries revenue. */
  wonAt: Date | null;
  /** The real appointment the request is linked to: the existing link when it
   *  is among the buckets, else the earliest real bucket. Never synthetic. */
  primary: AppointmentBucket | null;
  completedAt: Date | null;
  completedEncounterId: string | null;
  noShowAt: Date | null;
}

/** Pass 2: fold all buckets attributed to one request. Pure. */
export function aggregateRequestBuckets(
  buckets: AppointmentBucket[],
  existingPvsAppointmentId: string | null = null
): RequestAggregate {
  let status: DerivedStatus | null = null;
  let invoiceCents = 0;
  let refundedCents = 0;
  let wonAt: Date | null = null;
  let completedAt: Date | null = null;
  let completedEncounterId: string | null = null;
  let noShowAt: Date | null = null;
  for (const b of buckets) {
    const s = deriveStatusForBucket(b);
    if (s && (!status || STATUS_RANK[s] > STATUS_RANK[status])) status = s;
    invoiceCents += b.invoiceCents;
    refundedCents += b.refundedCents;
    if (b.invoiceCents > 0 && b.earliestInvoiceAt && (!wonAt || b.earliestInvoiceAt < wonAt)) {
      wonAt = b.earliestInvoiceAt;
    }
    if (b.completedAt && (!completedAt || b.completedAt > completedAt)) {
      completedAt = b.completedAt;
      completedEncounterId = b.pvsEncounterId;
    }
    if (b.noShowAt && (!noShowAt || b.noShowAt > noShowAt)) noShowAt = b.noShowAt;
  }
  const real = buckets.filter((b) => !b.synthetic);
  const primary =
    (existingPvsAppointmentId
      ? real.find((b) => b.pvsAppointmentId === existingPvsAppointmentId)
      : undefined) ??
    real
      .slice()
      .sort(
        (a, b) =>
          (bucketReferenceDate(a)?.getTime() ?? Infinity) -
            (bucketReferenceDate(b)?.getTime() ?? Infinity) ||
          a.pvsAppointmentId.localeCompare(b.pvsAppointmentId)
      )[0] ??
    null;
  return {
    status,
    invoiceCents,
    refundedCents,
    wonAt,
    primary,
    completedAt,
    completedEncounterId,
    noShowAt: status === "no_show" ? noShowAt : null,
  };
}

/**
 * Pass 2: the lead's money went back. All of its revenue was refunded, so a
 * gewonnen -> lower move is explained by the PVS itself, not by a linker
 * error. Such downgrades are applied (revenue written as 0.00) instead of
 * being held behind the P2-3 alarm forever with the refunded amount still on
 * the dashboard.
 */
export function isRefundExplained(agg: RequestAggregate): boolean {
  return agg.invoiceCents === 0 && agg.refundedCents > 0;
}

/** Pass 2: the purchases to report for one request: each invoice once, at its
 *  net (refund-adjusted) value, never a zero or fully refunded invoice. */
export function conversionsToSend(
  buckets: AppointmentBucket[]
): Array<{ eventLogId: string; valueCents: number; paidAt: Date; currency?: "EUR" | "CHF" }> {
  const out: Array<{ eventLogId: string; valueCents: number; paidAt: Date; currency?: "EUR" | "CHF" }> = [];
  for (const b of buckets) {
    for (const inv of b.invoiceEvents) {
      if (inv.netCents > 0) {
        out.push({ eventLogId: inv.eventLogId, valueCents: inv.netCents, paidAt: inv.paidAt, currency: inv.currency });
      }
    }
  }
  return out;
}

const toCents = (eur: string | null | undefined): number | null =>
  eur === null || eur === undefined ? null : Math.round(parseFloat(eur) * 100);

/**
 * Apply one request's aggregate. Returns `true` if the status write happened,
 * `false` if it was suppressed (P2-3 cascade-downgrade gate) or there was
 * nothing to write. When suppressed, the caller MUST also skip the downstream
 * ads-conversion fanout — the alarm row holds the change in a queue for
 * operator review, and firing CAPI/OCI on top of a still-gewonnen request
 * would emit duplicate conversion events later when the operator approves.
 */
async function applyToRequest(
  current: {
    id: string;
    status: string;
    pvsAppointmentId: string | null;
    convertedRevenueEur: string | null;
  },
  agg: RequestAggregate,
  clinicId: string
): Promise<boolean> {
  const requestId = current.id;
  const currentStatus = current.status;
  const derivedStatus = agg.status;
  const refundExplained = isRefundExplained(agg);
  if (!derivedStatus && !refundExplained) return false;

  // P2-3: status-downgrade alarm. If the current row is already
  // 'gewonnen' but the new derive run wouldn't keep it there, hold the
  // change behind a dashboard alert. The alarm row's dedupe_key uses
  // requestId + day so a re-run on the same day doesn't multiply rows.
  // Pass 2: a downgrade explained by refunds is applied (below), except when
  // the buckets carry no other stage to fall back to: then only the revenue
  // is corrected and the status is held for the operator.
  if (currentStatus === "gewonnen" && derivedStatus !== "gewonnen") {
    if (!refundExplained || !derivedStatus) {
      if (refundExplained) {
        await db
          .update(schema.requests)
          .set({ convertedRevenueEur: "0.00" })
          .where(eq(schema.requests.id, requestId));
      }
      await raiseStatusDowngradeAlarm({
        clinicId,
        requestId,
        pvsAppointmentId: agg.primary?.pvsAppointmentId ?? current.pvsAppointmentId ?? "ohne Termin",
        fromStatus: currentStatus,
        toStatus: derivedStatus ?? "unbekannt",
        invoiceCents: agg.invoiceCents,
      });
      return false;
    }
  }
  if (!derivedStatus) return false;

  // Stamp firstContactedAt on the *first* transition out of 'neu'. Any
  // bridge-derived status (termin_vereinbart, beratung_erschienen, behandelt,
  // no_show, gewonnen) implies contact happened — you can't book/treat a
  // patient you never reached. Only set when the row is leaving 'neu'; once
  // set, never overwritten (so a row that bounces termin_vereinbart →
  // no_show → termin_vereinbart keeps its original timestamp).
  // Seit Migration 0046 ist 'qualifiziert' weg und der Bridge-Move
  // 'neu → *' ist das einzige Kontaktsignal, das wir automatisch ableiten
  // können (Option 1b der first-contacted-Strategie).
  const stampFirstContact = currentStatus === "neu";

  const newRevenueEur =
    agg.invoiceCents > 0
      ? (agg.invoiceCents / 100).toFixed(2)
      : refundExplained
        ? "0.00"
        : undefined;

  await db
    .update(schema.requests)
    .set({
      status: derivedStatus,
      statusSource: "pvs",
      // Keep an existing link; a synthetic bucket never becomes one.
      pvsAppointmentId: current.pvsAppointmentId ? undefined : agg.primary?.pvsAppointmentId,
      pvsEncounterId: agg.completedEncounterId ?? agg.primary?.pvsEncounterId ?? undefined,
      appointmentAt: agg.primary?.scheduledAt ?? undefined,
      // Pass 2: cleared when the lead is no longer a no-show.
      noShowAt: agg.noShowAt,
      completedAt: agg.completedAt ?? undefined,
      convertedRevenueEur: newRevenueEur,
      wonAt: agg.invoiceCents > 0 ? (agg.wonAt ?? undefined) : refundExplained ? null : undefined,
      firstContactedAt: stampFirstContact ? new Date() : undefined,
    })
    .where(eq(schema.requests.id, requestId));

  // Log the auto-update as a request_activity so the timeline shows it.
  // Pass 2: only when something visible changed. Every derive run (each new
  // PVS event of the patient) used to add another identical "PVS: gewonnen".
  const revenueChanged =
    newRevenueEur !== undefined && toCents(newRevenueEur) !== toCents(current.convertedRevenueEur);
  if (derivedStatus !== currentStatus || revenueChanged) {
    await db.insert(schema.requestActivities).values({
      requestId,
      actorId: null,
      kind: "status_change",
      body: `PVS: ${derivedStatus}`,
      // Pass 2: from/to like every other status_change writer. The KPI
      // open-queue history (queries/kpis.ts) reads meta.from and the forecast
      // stage history (queries/forecast.ts) reads meta.to; PVS moves were
      // invisible to both.
      meta: {
        source: "pvs",
        from: currentStatus,
        to: derivedStatus,
        pvsAppointmentId: agg.primary?.pvsAppointmentId ?? current.pvsAppointmentId,
        invoiceCents: agg.invoiceCents,
        refundedCents: agg.refundedCents,
        derivedStatus,
      },
    });
  }

  return true;
}

/**
 * For each InvoicePaid event tied to this appointment, insert an outbox
 * row per channel and enqueue the corresponding worker.
 *
 * Idempotency: the outbox UNIQUE(clinic_id, channel, pvs_event_log_id)
 * makes this safe under derive-replay — rows already inserted on a prior
 * run are no-ops on the insert side and don't re-enqueue.
 *
 * Failure to insert/enqueue MUST NOT roll back the request update above.
 * Practical reason: pvs-status-derive is the source of truth for "gewonnen"
 * status in the UI; if the enqueue fails, we still want the praxis to see
 * the correct status. Returns the number of failed inserts; the caller fails
 * the derive job after every request is written, so pg-boss retries it (no
 * other job re-emits missing outbox rows).
 */
async function fanoutInvoiceConversions(
  clinicId: string,
  requestId: string,
  sends: ReturnType<typeof conversionsToSend>
): Promise<number> {
  // Pass 2: nothing to report (no invoice, all zero or fully refunded).
  if (sends.length === 0) return 0;
  // P2-3: look up the request's click-id age + the platform's most-
  // recent activity. If the click is older than STALE_CLICK_ID_DAYS the
  // platform will reject the upload anyway, so we hold the conversion
  // behind an alert instead of burning the API quota.
  const [reqRow] = await db
    .select({
      createdAt: schema.requests.createdAt,
      fbclid: schema.requests.fbclid,
      gclid: schema.requests.gclid,
    })
    .from(schema.requests)
    .where(eq(schema.requests.id, requestId))
    .limit(1);
  const hasClickId = !!(reqRow?.fbclid || reqRow?.gclid);
  const clickAgeDays = reqRow?.createdAt
    ? Math.floor(
        (Date.now() - reqRow.createdAt.getTime()) / (24 * 60 * 60 * 1000)
      )
    : null;
  const clickIsStale =
    hasClickId &&
    clickAgeDays !== null &&
    clickAgeDays > STALE_CLICK_ID_DAYS;

  // The "no recent activity on the ad-id" gate from the plan: if the
  // platform credential hasn't synced any campaign data in the last 90d
  // either, the click target is even more obviously dead. We check
  // platform_credentials.last_synced_at as a proxy because the actual
  // per-ad activity isn't stored row-wise — a clinic that disabled ads
  // 90+ days ago has a stale last_synced_at across both channels.
  let credsStale = false;
  if (clickIsStale) {
    const ninetyDaysAgo = new Date(
      Date.now() - STALE_CLICK_ID_DAYS * 24 * 60 * 60 * 1000
    );
    const recentCreds = await db
      .select({ id: schema.platformCredentials.id })
      .from(schema.platformCredentials)
      .where(
        and(
          eq(schema.platformCredentials.clinicId, clinicId),
          gte(schema.platformCredentials.lastSyncedAt, ninetyDaysAgo)
        )
      )
      .limit(1);
    credsStale = recentCreds.length === 0;
  }

  if (clickIsStale && credsStale && reqRow?.createdAt) {
    // Raise the alarm once per request/day, then skip the outbox
    // insert. The operator can manually insert outbox rows for legit
    // late-conversions; the typical path here is "the lead converted
    // organically months later, not via the ad", which is exactly the
    // case we want to suppress automated emission for.
    let totalValueCents = 0;
    for (const invoice of sends) totalValueCents += invoice.valueCents;
    await raiseStaleClickIdAlarm({
      clinicId,
      requestId,
      clickCreatedAt: reqRow.createdAt,
      valueEur: totalValueCents / 100,
    });
    return 0;
  }

  let failures = 0;
  for (const invoice of sends) {
    try {
      await enqueueInvoiceConversions({
        clinicId,
        requestId,
        pvsEventLogId: invoice.eventLogId,
        valueEur: invoice.valueCents / 100,
        // Phase 11: attribute in the invoice's real currency (EUR/CHF);
        // defaults EUR in the outbox insert.
        currency: invoice.currency,
        occurredAt: invoice.paidAt,
      });
    } catch (err) {
      console.error(
        `[pvs-status-derive] ads-outbox fanout failed (request=${requestId}, event_log=${invoice.eventLogId}):`,
        err
      );
      // Request update already committed; the caller fails the job after
      // all requests are written so pg-boss retries (pass 2).
      failures++;
    }
  }
  return failures;
}

// ---------------------------------------------------------------
// EINS Bewertungen — schedule a review when a PVS encounter completes
// ---------------------------------------------------------------

/**
 * Schedule a post-visit review-request when a PVS encounter has completed.
 * Called from applyAppointmentBuckets after a bucket carrying `completedAt`
 * has been applied to its request.
 *
 * Three PVS-specific concerns:
 *   1. Email — PVS canonical events are pseudonymized and carry no address.
 *      We resolve it from the EINS lead linkage: the request's contactEmail
 *      (captured at lead intake), falling back to the linked patient row. A
 *      walk-in with no EINS lead has neither, so we SKIP silently — never
 *      invent an address. This is what scopes EINS Bewertungen to EINS-attributed
 *      patients.
 *   2. Consent — the stream carries no per-event consent, so we gate on the
 *      per-Praxis attestation `clinics.review_consent_attested` (HWG model,
 *      §7 UWG Abs. 3 Nr. 4) in addition to the master switch
 *      `reviewRequestEnabled`.
 *   3. Idempotency — handled inside scheduleReviewRequest (per-appointment
 *      pre-check + the 0058 unique index), so a re-derived encounter never
 *      schedules a second email.
 *
 * Best-effort: a failure here MUST NOT roll back the status derivation above
 * ("PVS gewinnt immer"). The next derive run retries idempotently.
 *
 * Exported for unit tests (pvs-review-schedule.test.ts).
 */
export async function maybeScheduleReviewForCompletedEncounter(args: {
  clinicId: string;
  portalPatientId: string;
  requestId: string;
  bucket: AppointmentBucket;
}): Promise<void> {
  const { clinicId, portalPatientId, requestId, bucket } = args;
  try {
    // Gate on BOTH the master switch and the HWG attestation.
    const [clinic] = await db
      .select({
        reviewRequestEnabled: schema.clinics.reviewRequestEnabled,
        reviewConsentAttested: schema.clinics.reviewConsentAttested,
        reviewRequestDelayDays: schema.clinics.reviewRequestDelayDays,
      })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, clinicId))
      .limit(1);
    if (
      !clinic ||
      !clinic.reviewRequestEnabled ||
      !clinic.reviewConsentAttested
    ) {
      return;
    }

    // Resolve the patient email from the EINS lead linkage. Prefer the email
    // captured on the request at lead intake; fall back to the linked patient.
    const [reqRow] = await db
      .select({
        contactEmail: schema.requests.contactEmail,
        contactName: schema.requests.contactName,
      })
      .from(schema.requests)
      .where(eq(schema.requests.id, requestId))
      .limit(1);

    let email = reqRow?.contactEmail?.trim() ?? "";
    let patientName: string | null = reqRow?.contactName ?? null;

    if (!email) {
      const [pat] = await db
        .select({
          email: schema.patients.email,
          fullName: schema.patients.fullName,
        })
        .from(schema.patients)
        .where(eq(schema.patients.id, portalPatientId))
        .limit(1);
      email = pat?.email?.trim() ?? "";
      patientName = patientName ?? pat?.fullName ?? null;
    }

    if (!email) {
      // Walk-in / no EINS lead — correctly out of scope for EINS Bewertungen.
      return;
    }

    await scheduleReviewRequest({
      clinicId,
      patientId: portalPatientId,
      email,
      patientName,
      treatmentLabel: bucket.treatmentLabel,
      completedAt: bucket.completedAt,
      delayDays: clinic.reviewRequestDelayDays,
      requestId,
      pvsAppointmentId: bucket.pvsAppointmentId,
      pvsEncounterId: bucket.pvsEncounterId,
    });
  } catch (err) {
    console.error(
      `[pvs-status-derive] review scheduling failed (clinic=${clinicId}, request=${requestId}, appt=${bucket.pvsAppointmentId}):`,
      err
    );
    // Swallow — request status already committed; review scheduling is
    // best-effort and the next derive re-run will retry (idempotent).
  }
}
