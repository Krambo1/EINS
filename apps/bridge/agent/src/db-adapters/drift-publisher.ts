import { createHmac } from "node:crypto";
import { loadConfig } from "../config.js";
import { loadSecret } from "../secure-store.js";
import {
  markDriftReported,
  pendingDriftReports,
} from "./framework.js";
import type { DriftReport } from "./types.js";

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
  medatixx: "gdt_agent",
  "cgm-albis": "gdt_agent",
  "cgm-turbomed": "gdt_agent",
  "cgm-m1pro": "gdt_agent",
  "cgm-m1pro-oracle-db": "gdt_agent",
  indamed: "gdt_agent",
  quincy: "gdt_agent",
  pixelmedics: "gdt_agent",
};

/** Map an agent-side YAML vendor id to the portal's pvs_event_log
 *  bridge_source enum. Tomedo's db-adapter shares the "tomedo" bridge
 *  source with its REST adapter (so the portal's vendor-mismatch guard
 *  passes on a pvs_link.vendor='tomedo' row); the other db-adapters share
 *  the "gdt_agent" bridge source (same agent binary, different ingest
 *  path). The exact mapping table is the single source of truth: if a
 *  new vendor lands without a row here we fall back to "gdt_agent" rather
 *  than crashing. */
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
  report: DriftReport & { id: number },
  clinicId: string
): NormalizedReport {
  const payload = {
    clinicId,
    pvsVendor: report.vendorId,
    bridgeSource: bridgeSourceForVendor(report.vendorId),
    streamKind: report.streamKind,
    eventKind: "schema_drift" as const,
    severity: "warn" as const,
    message: buildMessage(report),
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

function buildMessage(report: DriftReport): string {
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
