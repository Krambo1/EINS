import { createHmac } from "node:crypto";
import { loadConfig } from "../config.js";
import { loadSecret } from "../secure-store.js";
import {
  markDriftReported,
  pendingDriftReports,
} from "./framework.js";
import type { PendingHealthReport } from "./types.js";

/**
 * Drift-publisher.
 *
 * The SQL-introspection framework writes a row to `db_adapter_drift`
 * whenever a stream's column shape doesn't match the snapshot taken on
 * its first successful poll. The runner halts that stream locally so it
 * stops emitting (potentially empty) events.
 *
 * This module drains those rows on a cadence and POSTs each one to the
 * portal's /api/pvs/health endpoint (HMAC-signed with the same per-clinic
 * PVS secret used by canonical events). Retries are safe: the portal's
 * dedup index on (clinic, vendor, stream, event_kind, detected_at) makes
 * a re-send a no-op. We only mark a row as `reported_to_portal=1` after
 * the portal returns 2xx, so a transient outage replays cleanly.
 *
 * Vendor identification: the agent's DriftReport.vendorId is the YAML
 * `vendor:` field (e.g. "tomedo-db", "medatixx"). The portal stores the
 * exact string so the UI can render the same identifier the Praxis IT
 * person sees in the YAML.
 */

const HEALTH_PATH = "/api/pvs/health";

const VENDOR_TO_BRIDGE_SOURCE: Record<string, string> = {
  "tomedo-db": "tomedo",
  "medatixx-db": "medatixx",
  "cgm-albis-db": "cgm_albis",
  "cgm-turbomed-db": "cgm_turbomed",
  "cgm-m1pro-db": "cgm_m1pro",
  "cgm-m1pro-oracle-db": "cgm_m1pro",
  "indamed-db": "indamed",
  "quincy-db": "quincy",
  "pixelmedics-db": "pixelmedics",
};

/** Map an agent-side YAML vendor id (the config's `vendor:` field, e.g.
 *  "medatixx-db") to the canonical bridge_source the portal ingests.
 *
 *  Phase 8 per-vendor identity: each on-prem DB-read engine is now its own
 *  first-class provenance. tomedo-db keeps "tomedo" (its REST sibling owns
 *  that source and the pvs_link.pvs_vendor='tomedo' fast path matches);
 *  every other engine maps to its own value (medatixx, cgm_albis, ...),
 *  with both CGM-M1 variants (MSSQL + Oracle) collapsing to cgm_m1pro.
 *
 *  Keys are the FULL vendor ids because that is exactly what the two callers
 *  pass: the drift publisher passes report.vendorId (= VendorConfig.vendor)
 *  and the heartbeat passes DbAdapterEnrollment.vendor. This table MUST stay
 *  in lock-step with each YAML's `bridgeSource:` field (canonical events
 *  stamp that field directly via the normalizer, so a divergence here would
 *  label health reports with a different source than the events they describe
 *  and break pvs_link_source heartbeat-seeding); configs.test.ts pins the two
 *  together. A vendor with no row here falls back to "gdt_agent" rather than
 *  crashing. */
export function bridgeSourceForVendor(vendorId: string): string {
  return VENDOR_TO_BRIDGE_SOURCE[vendorId] ?? "gdt_agent";
}

export interface PublishOutcome {
  attempted: number;
  delivered: number;
  deferred: number;
  failed: number;
}

export interface PublishOptions {
  /** Override fetch for tests. Receives URL + RequestInit; must return a
   *  Response-like object with .ok and .status. */
  fetchImpl?: typeof fetch;
  /** Override secret loader for tests. */
  secretLoader?: () => Promise<string | null>;
  /** Override config loader for tests. */
  configLoader?: () => Promise<{
    clinicId: string;
    portalBaseUrl: string;
  } | null>;
}

interface NormalizedReport {
  id: number;
  payload: Record<string, unknown>;
  rawBody: string;
}

/**
 * Drain pending drift rows, POST each, mark each as reported on 2xx.
 *
 * Returns a summary so the caller's log line reads as one tick per cycle
 * rather than one line per row.
 */
export async function publishPendingDrift(
  opts: PublishOptions = {}
): Promise<PublishOutcome> {
  const cfg = await (opts.configLoader ?? loadConfig)();
  if (!cfg) {
    return { attempted: 0, delivered: 0, deferred: 0, failed: 0 };
  }
  const secret = await (opts.secretLoader ?? loadSecret)();
  if (!secret) {
    return { attempted: 0, delivered: 0, deferred: 0, failed: 0 };
  }

  const pending = pendingDriftReports();
  if (pending.length === 0) {
    return { attempted: 0, delivered: 0, deferred: 0, failed: 0 };
  }

  const fetcher = opts.fetchImpl ?? fetch;
  const url = `${cfg.portalBaseUrl.replace(/\/$/, "")}${HEALTH_PATH}`;
  let delivered = 0;
  let deferred = 0;
  let failed = 0;

  for (const report of pending) {
    const normalized = normalizeReport(report, cfg.clinicId);
    const sig = `sha256=${createHmac("sha256", secret)
      .update(normalized.rawBody)
      .digest("hex")}`;
    let res: Response;
    try {
      res = await fetcher(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-eins-signature": sig,
        },
        body: normalized.rawBody,
      });
    } catch (err) {
      console.warn(
        `[drift-publisher] network error for ${report.vendorId}/${report.streamKind}: ${(err as Error).message}`
      );
      deferred++;
      continue;
    }

    if (res.ok) {
      markDriftReported(report.id);
      delivered++;
      continue;
    }

    // 429 / 5xx are transient: leave the row in the queue. Next tick
    // retries.
    if (res.status === 429 || res.status >= 500) {
      deferred++;
      continue;
    }

    // 4xx (other than 429) is non-recoverable from the agent's side
    // (bad envelope, vendor mismatch with portal pvs_link, clinic not
    // found). Mark reported so we don't loop on it; the row sits in
    // `db_adapter_drift` with reported_to_portal=1 for forensic value.
    console.error(
      `[drift-publisher] non-retryable error ${res.status} for ${report.vendorId}/${report.streamKind}; marking reported.`
    );
    markDriftReported(report.id);
    failed++;
  }

  return { attempted: pending.length, delivered, deferred, failed };
}

function normalizeReport(
  report: PendingHealthReport,
  clinicId: string
): NormalizedReport {
  // Both report kinds share the envelope + transport; only the eventKind,
  // severity, message and detail shape differ. The portal's pvs_link_health
  // schema accepts both event_kind values (migration 0054).
  const payload =
    report.reportKind === "config_invalid"
      ? {
          clinicId,
          pvsVendor: report.vendorId,
          bridgeSource: bridgeSourceForVendor(report.vendorId),
          streamKind: report.streamKind,
          eventKind: "config_invalid" as const,
          // Ingesting corrupt revenue is worse than a quiet stream, so a
          // config-invalid halt is an error, not a warning.
          severity: "error" as const,
          message: buildConfigInvalidMessage(report),
          detail: report.configInvalidDetail ?? {},
          detectedAt: report.detectedAt,
        }
      : {
          clinicId,
          pvsVendor: report.vendorId,
          bridgeSource: bridgeSourceForVendor(report.vendorId),
          streamKind: report.streamKind,
          eventKind: "schema_drift" as const,
          severity: "warn" as const,
          message: buildDriftMessage(report),
          detail: {
            expected: report.expectedColumns,
            observed: report.observedColumns,
            missing: report.missing,
            added: report.added,
          },
          detectedAt: report.detectedAt,
        };
  return {
    id: report.id,
    payload,
    rawBody: JSON.stringify(payload),
  };
}

function buildDriftMessage(report: PendingHealthReport): string {
  const parts: string[] = [];
  if (report.missing.length > 0) {
    parts.push(`fehlende Spalten: ${report.missing.join(", ")}`);
  }
  if (report.added.length > 0) {
    parts.push(`neue Spalten: ${report.added.join(", ")}`);
  }
  if (parts.length === 0) {
    parts.push("Spalten-Reihenfolge weicht ab");
  }
  return `Schema-Drift in ${report.vendorId}/${report.streamKind}: ${parts.join("; ")}`;
}

/**
 * Config-invalid message, kept under the portal's 500-char cap: lead with the
 * failing fields and the pass count. German, Sie-form, no em-dashes.
 */
function buildConfigInvalidMessage(report: PendingHealthReport): string {
  const detail = report.configInvalidDetail;
  const fields = (detail?.issues ?? []).map((i) => i.field);
  const shown = fields.slice(0, 5).join(", ");
  const more = fields.length > 5 ? `, +${fields.length - 5} weitere` : "";
  const fieldPart = shown
    ? `Felder ${shown}${more} lieferten unerwartete Werte`
    : "die Daten entsprechen nicht der Konfiguration";
  const counts = detail
    ? ` (Stichprobe: ${detail.passingRows}/${detail.sampleSize} Zeilen gültig)`
    : "";
  const msg = `Konfiguration prüfen in ${report.vendorId}/${report.streamKind}: ${fieldPart}${counts}.`;
  return msg.length > 500 ? `${msg.slice(0, 497)}...` : msg;
}
