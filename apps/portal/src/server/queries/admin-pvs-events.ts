import "server-only";
import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * Read-side queries for /admin/pvs-bridge/events.
 *
 * Hard row cap on listEvents so the table-render stays predictable even
 * when filters yield millions of rows; the virtualizer copes with the
 * cap fine and the operator narrows further if they hit it. Banner in
 * the UI calls this out so nobody assumes they're seeing the full set.
 */

export const EVENTS_HARD_CAP = 5000;

// Local copy of the canonical BRIDGE_SOURCES, used only to populate + validate
// the admin event-trace `?bridgeSource=` filter (an unknown value is dropped,
// not rejected). Kept in step with apps/bridge/src/canonical/schema-source.ts;
// the last 7 are the Phase 7 per-Praxis DB-read engines so the admin can filter
// by them once they start emitting (Phase 8).
export const BRIDGE_SOURCES = [
  "tomedo",
  "healthhub",
  "red",
  "pabau",
  "consentz",
  "gdt_agent",
  "csv_upload",
  "n8n_custom",
  "medatixx",
  "cgm_albis",
  "cgm_turbomed",
  "cgm_m1pro",
  "indamed",
  "quincy",
  "pixelmedics",
] as const;
export type BridgeSourceValue = (typeof BRIDGE_SOURCES)[number];

export const EVENT_KINDS = [
  "PatientUpserted",
  "AppointmentCreated",
  "AppointmentStatusChanged",
  "AppointmentCancelled",
  "EncounterCompleted",
  "InvoicePaid",
  "RecallScheduled",
  "PatientMerged",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface EventsFilters {
  clinicId?: string;
  bridgeSource?: BridgeSourceValue;
  kind?: EventKind;
  from: Date;
  to: Date;
}

export interface EventRow {
  id: string;
  clinicId: string;
  clinicDisplayName: string | null;
  bridgeSource: string;
  kind: string;
  pvsExternalEventId: string;
  occurredAt: Date;
  receivedAt: Date;
}

export async function listEvents(
  filters: EventsFilters
): Promise<{ rows: EventRow[]; truncated: boolean }> {
  const conds = [
    gte(schema.pvsEventLog.occurredAt, filters.from),
    lte(schema.pvsEventLog.occurredAt, filters.to),
  ];
  if (filters.clinicId) {
    conds.push(eq(schema.pvsEventLog.clinicId, filters.clinicId));
  }
  if (filters.bridgeSource) {
    conds.push(eq(schema.pvsEventLog.bridgeSource, filters.bridgeSource));
  }
  if (filters.kind) {
    conds.push(eq(schema.pvsEventLog.kind, filters.kind));
  }

  const rows = await db
    .select({
      id: schema.pvsEventLog.id,
      clinicId: schema.pvsEventLog.clinicId,
      clinicDisplayName: schema.clinics.displayName,
      bridgeSource: schema.pvsEventLog.bridgeSource,
      kind: schema.pvsEventLog.kind,
      pvsExternalEventId: schema.pvsEventLog.pvsExternalEventId,
      occurredAt: schema.pvsEventLog.occurredAt,
      receivedAt: schema.pvsEventLog.receivedAt,
    })
    .from(schema.pvsEventLog)
    .leftJoin(
      schema.clinics,
      eq(schema.clinics.id, schema.pvsEventLog.clinicId)
    )
    .where(and(...conds))
    .orderBy(desc(schema.pvsEventLog.occurredAt))
    .limit(EVENTS_HARD_CAP + 1);

  const truncated = rows.length > EVENTS_HARD_CAP;
  return {
    rows: truncated ? rows.slice(0, EVENTS_HARD_CAP) : rows,
    truncated,
  };
}

export interface EventDetail {
  id: string;
  clinicId: string;
  clinicDisplayName: string | null;
  bridgeSource: string;
  kind: string;
  pvsExternalEventId: string;
  occurredAt: Date;
  receivedAt: Date;
  ingestedAt: Date;
  payload: Record<string, unknown>;
}

export async function getEventDetail(
  id: string
): Promise<EventDetail | null> {
  const [row] = await db
    .select({
      id: schema.pvsEventLog.id,
      clinicId: schema.pvsEventLog.clinicId,
      clinicDisplayName: schema.clinics.displayName,
      bridgeSource: schema.pvsEventLog.bridgeSource,
      kind: schema.pvsEventLog.kind,
      pvsExternalEventId: schema.pvsEventLog.pvsExternalEventId,
      occurredAt: schema.pvsEventLog.occurredAt,
      receivedAt: schema.pvsEventLog.receivedAt,
      ingestedAt: schema.pvsEventLog.ingestedAt,
      payload: schema.pvsEventLog.payload,
    })
    .from(schema.pvsEventLog)
    .leftJoin(
      schema.clinics,
      eq(schema.clinics.id, schema.pvsEventLog.clinicId)
    )
    .where(eq(schema.pvsEventLog.id, id))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    payload: row.payload as Record<string, unknown>,
  };
}

export interface DriftReportRow {
  id: string;
  clinicId: string;
  clinicDisplayName: string | null;
  pvsVendor: string;
  bridgeSource: string;
  streamKind: string;
  severity: string;
  message: string;
  detail: Record<string, unknown>;
  detectedAt: Date;
}

export async function listOpenDriftReports(): Promise<DriftReportRow[]> {
  const rows = await db
    .select({
      id: schema.pvsLinkHealth.id,
      clinicId: schema.pvsLinkHealth.clinicId,
      clinicDisplayName: schema.clinics.displayName,
      pvsVendor: schema.pvsLinkHealth.pvsVendor,
      bridgeSource: schema.pvsLinkHealth.bridgeSource,
      streamKind: schema.pvsLinkHealth.streamKind,
      severity: schema.pvsLinkHealth.severity,
      message: schema.pvsLinkHealth.message,
      detail: schema.pvsLinkHealth.detail,
      detectedAt: schema.pvsLinkHealth.detectedAt,
    })
    .from(schema.pvsLinkHealth)
    .leftJoin(
      schema.clinics,
      eq(schema.clinics.id, schema.pvsLinkHealth.clinicId)
    )
    .where(
      and(
        eq(schema.pvsLinkHealth.eventKind, "schema_drift"),
        isNull(schema.pvsLinkHealth.resolvedAt)
      )
    )
    .orderBy(asc(schema.pvsLinkHealth.detectedAt))
    .limit(500);

  return rows.map((r) => ({
    ...r,
    detail: r.detail as Record<string, unknown>,
  }));
}

export interface ClinicOption {
  id: string;
  label: string;
}

export async function listClinicsForFilter(): Promise<ClinicOption[]> {
  const rows = await db
    .select({
      id: schema.clinics.id,
      displayName: schema.clinics.displayName,
      legalName: schema.clinics.legalName,
    })
    .from(schema.clinics)
    .where(isNull(schema.clinics.archivedAt))
    .orderBy(asc(schema.clinics.displayName));
  return rows.map((r) => ({
    id: r.id,
    label: r.displayName ?? r.legalName ?? r.id.slice(0, 8),
  }));
}

/**
 * Worker-Effekt linkage from a pvs_event_log row to derived rows in
 * `requests` / `kpi_daily`. Today there is no foreign-key column tying
 * derived state back to a specific event_log.id; the derive-worker
 * (pvs-status-derive) holds the linkage only in its in-memory bucket
 * before writing aggregates. We surface that gap honestly rather than
 * guessing via a temporal join that would lie when amounts collide.
 *
 * Wiring an explicit `requests.source_event_log_id` (or analogous)
 * column is the proper fix; that's a separate migration and out of
 * scope for this UI cut.
 */
export interface WorkerEffect {
  kind: "unlinked";
  reason: string;
}

export function describeWorkerEffect(detail: EventDetail): WorkerEffect {
  return {
    kind: "unlinked",
    reason:
      detail.kind === "InvoicePaid"
        ? "derive-worker speichert die Verknüpfung InvoicePaid → requests/kpi_daily heute nicht als Spalte (nur als In-Memory-Bucket beim Aggregieren)."
        : "derive-worker speichert die Verknüpfung event → requests/kpi_daily heute nicht als Spalte.",
  };
}
