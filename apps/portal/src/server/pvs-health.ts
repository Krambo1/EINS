import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db/client";

/**
 * PVS Bridge: inbound health-signal handler.
 *
 * Producers:
 *   • apps/bridge/agent/src/db-adapters/drift-publisher.ts: the
 *     SQL-introspection agent flushes pendingDriftReports() here whenever
 *     framework.ts detects a column shape mismatch on a stream (Phase 4
 *     schema-drift detection per UNIVERSAL_ADAPTER_BUILD.md §5.4).
 *   • apps/bridge/src/adapters/* cloud REST adapters: emit
 *     auth_expired / connection_lost / rate_limited when the per-link
 *     fail threshold is exceeded.
 *
 * One row per (clinic, vendor, stream, event_kind, detected_at) tuple. The
 * `*_recovered` variant updates the most recent matching open row's
 * resolved_at so the integrations UI can stop surfacing the warning.
 *
 * Why a separate route from /api/pvs/events: health is operational
 * telemetry, not patient data. Separate Zod schema, separate table,
 * separate retention policy.
 *
 * Idempotency: agent retries until 2xx; the dedup is on
 * (clinic, vendor, stream, event_kind, detected_at). Replays return
 * `{status: 'deduped'}` instead of erroring.
 */

// ---------------------------------------------------------------
// Zod envelope
// ---------------------------------------------------------------

const isoDatetime = z.string().datetime({ offset: true });

// Kept in sync with the canonical BRIDGE_SOURCES + pvs-events.ts. The last 7
// are the Phase 7 per-Praxis DB-read engines, accepted here so a config_invalid
// / schema_drift health event from e.g. the medatixx adapter ingests (Phase 8
// has the agent stamp them).
const BridgeSource = z.enum([
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
]);

/**
 * Vendor identifier as used on the bridge side. This is the YAML
 * `vendor:` field for db-adapter sources (e.g. "tomedo-db", "medatixx",
 * "cgm-albis", "indamed") and equals the bridge-source string for
 * cloud REST adapters. Free-form text is intentional: new vendors are
 * configured by dropping a YAML file, not by code change.
 */
const PvsVendor = z.string().min(1).max(64);

const StreamKind = z.enum([
  "PatientUpserted",
  "AppointmentCreated",
  "AppointmentStatusChanged",
  "AppointmentCancelled",
  "EncounterCompleted",
  "InvoicePaid",
  "RecallScheduled",
  "PatientMerged",
  "vendor",
]);

const EventKind = z.enum([
  "schema_drift",
  "schema_recovered",
  "stream_error",
  "stream_recovered",
  "auth_expired",
  "connection_lost",
  "rate_limited",
  // Phase 5: the agent's first-poll value validator halted a stream because the
  // returned data does not match the YAML map (wrong status codes, mostly-NULL
  // required column, a failing transform). Widened in migration 0054.
  "config_invalid",
]);

const SchemaDriftDetail = z.object({
  expected: z.array(z.string()),
  observed: z.array(z.string()),
  missing: z.array(z.string()),
  added: z.array(z.string()),
});

const StreamErrorDetail = z.object({
  reason: z.string().max(1000),
  consecutiveFailures: z.number().int().nonnegative(),
});

const TransientDetail = z.object({
  reason: z.string().max(1000).optional(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
});

/** Phase 5: first-poll value-validation specifics. The integrations UI renders
 *  the failing fields, their cause, and a few sample raw values. */
const ConfigInvalidDetail = z.object({
  sampleSize: z.number().int().nonnegative(),
  passingRows: z.number().int().nonnegative(),
  threshold: z.number().min(0).max(1),
  issues: z
    .array(
      z.object({
        field: z.string().max(120),
        reason: z.string().max(500),
        sampleRawValues: z.array(z.string().max(200)).max(10),
      })
    )
    .max(40),
});

export const PvsHealthEventSchema = z
  .object({
    clinicId: z.string().uuid(),
    pvsVendor: PvsVendor,
    bridgeSource: BridgeSource,
    streamKind: StreamKind,
    eventKind: EventKind,
    severity: z.enum(["info", "warn", "error"]).default("warn"),
    message: z.string().min(1).max(500),
    detail: z
      .union([
        SchemaDriftDetail,
        StreamErrorDetail,
        ConfigInvalidDetail,
        TransientDetail,
        z.object({}).passthrough(),
      ])
      .default({}),
    detectedAt: isoDatetime,
    /** Honeypot: same pattern as /api/pvs/events. Tripping it returns 202
     *  without doing any work. */
    hp_field: z.string().optional(),
  })
  .strict();

export type PvsHealthEvent = z.infer<typeof PvsHealthEventSchema>;

// ---------------------------------------------------------------
// Applier
// ---------------------------------------------------------------

export type ApplyHealthResult =
  | {
      ok: true;
      status: "inserted" | "deduped" | "resolved";
      id: string | null;
    }
  | {
      ok: false;
      reason:
        | "clinic_not_found"
        | "vendor_mismatch"
        | "internal_error";
    };

const RECOVERY_EVENT_KINDS: ReadonlySet<string> = new Set([
  "schema_recovered",
  "stream_recovered",
]);

function failureKindForRecovery(eventKind: string): string | null {
  if (eventKind === "schema_recovered") return "schema_drift";
  if (eventKind === "stream_recovered") return "stream_error";
  return null;
}

/**
 * Persist a health event from the bridge.
 *
 * For failure events (schema_drift, stream_error, ...) we insert a new
 * row with resolved_at NULL and let the dedup index collapse retries.
 *
 * For recovery events (*_recovered) we mark the most recent matching
 * open failure as resolved. We do NOT insert a row of our own for the
 * recovery; the resolution-of-the-failure-row IS the recovery record.
 * This keeps the UI's "unresolved" query trivial.
 */
export async function applyPvsHealth(
  event: PvsHealthEvent
): Promise<ApplyHealthResult> {
  // Clinic existence + vendor match.
  const [link] = await db
    .select({
      clinicId: schema.pvsLink.clinicId,
      vendor: schema.pvsLink.pvsVendor,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, event.clinicId))
    .limit(1);

  if (!link) {
    // The Praxis is not enrolled. Better to fail loud than to silently
    // accept telemetry for a clinic we don't know about.
    return { ok: false, reason: "clinic_not_found" };
  }

  // Some health events arrive for a sub-vendor (e.g. "tomedo-db" on a
  // pvs_link.vendor='tomedo' row). We accept any health event whose
  // bridge_source matches the link's vendor OR whose pvs_vendor starts
  // with the link's vendor (db-adapter convention: "<vendor>" or
  // "<vendor>-db"). This keeps the UI's vendor row identifiable.
  if (link.vendor !== "none") {
    const matchesBridgeSource = event.bridgeSource === link.vendor;
    const matchesDbAdapter =
      event.pvsVendor === link.vendor ||
      event.pvsVendor.startsWith(`${link.vendor}-`);
    if (!matchesBridgeSource && !matchesDbAdapter) {
      return { ok: false, reason: "vendor_mismatch" };
    }
  }

  try {
    if (RECOVERY_EVENT_KINDS.has(event.eventKind)) {
      const failureKind = failureKindForRecovery(event.eventKind);
      if (failureKind) {
        const updated = await db
          .update(schema.pvsLinkHealth)
          .set({
            resolvedAt: new Date(event.detectedAt),
            resolutionNote: event.message,
          })
          .where(
            and(
              eq(schema.pvsLinkHealth.clinicId, event.clinicId),
              eq(schema.pvsLinkHealth.pvsVendor, event.pvsVendor),
              eq(schema.pvsLinkHealth.streamKind, event.streamKind),
              eq(schema.pvsLinkHealth.eventKind, failureKind),
              // SQL `IS NULL` predicate in drizzle.
              sql`${schema.pvsLinkHealth.resolvedAt} IS NULL`
            )
          )
          .returning({ id: schema.pvsLinkHealth.id });
        return {
          ok: true,
          status: "resolved",
          id: updated[0]?.id ?? null,
        };
      }
    }

    // Failure event: insert; UNIQUE on (clinic, vendor, stream, kind,
    // detected_at) makes a retried POST a no-op.
    const inserted = await db
      .insert(schema.pvsLinkHealth)
      .values({
        clinicId: event.clinicId,
        pvsVendor: event.pvsVendor,
        bridgeSource: event.bridgeSource,
        streamKind: event.streamKind,
        eventKind: event.eventKind,
        severity: event.severity,
        message: event.message,
        detail: event.detail as Record<string, unknown>,
        detectedAt: new Date(event.detectedAt),
      })
      .onConflictDoNothing({
        target: [
          schema.pvsLinkHealth.clinicId,
          schema.pvsLinkHealth.pvsVendor,
          schema.pvsLinkHealth.streamKind,
          schema.pvsLinkHealth.eventKind,
          schema.pvsLinkHealth.detectedAt,
        ],
      })
      .returning({ id: schema.pvsLinkHealth.id });

    if (inserted.length === 0) {
      return { ok: true, status: "deduped", id: null };
    }
    return { ok: true, status: "inserted", id: inserted[0]!.id };
  } catch (err) {
    console.error("[pvs-health] apply failed:", err);
    return { ok: false, reason: "internal_error" };
  }
}

/**
 * UI-side query helper: returns unresolved health events for a clinic
 * ordered by most-recent-first. The integrations page renders one warning
 * row per record.
 */
export async function listUnresolvedHealth(
  clinicId: string,
  limit = 20
): Promise<
  Array<{
    id: string;
    pvsVendor: string;
    bridgeSource: string;
    streamKind: string;
    eventKind: string;
    severity: string;
    message: string;
    detail: unknown;
    detectedAt: Date;
  }>
> {
  return db
    .select({
      id: schema.pvsLinkHealth.id,
      pvsVendor: schema.pvsLinkHealth.pvsVendor,
      bridgeSource: schema.pvsLinkHealth.bridgeSource,
      streamKind: schema.pvsLinkHealth.streamKind,
      eventKind: schema.pvsLinkHealth.eventKind,
      severity: schema.pvsLinkHealth.severity,
      message: schema.pvsLinkHealth.message,
      detail: schema.pvsLinkHealth.detail,
      detectedAt: schema.pvsLinkHealth.detectedAt,
    })
    .from(schema.pvsLinkHealth)
    .where(
      and(
        eq(schema.pvsLinkHealth.clinicId, clinicId),
        sql`${schema.pvsLinkHealth.resolvedAt} IS NULL`
      )
    )
    .orderBy(sql`${schema.pvsLinkHealth.detectedAt} DESC`)
    .limit(limit);
}
