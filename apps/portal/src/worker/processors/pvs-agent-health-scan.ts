import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  deriveUploadReason,
  evaluateAgentLiveness,
  evaluateHeartbeatHealth,
  reconcileAgentHealthAlerts,
  HEARTBEAT_SCOPE_KEYS,
  LIVENESS_SCOPE_KEYS,
  type AdapterStatusSnapshot,
  type AgentHealthCondition,
  type UploadDiagnostics,
} from "@/server/pvs-agent-health";
import { notifyOps } from "@/server/ops-alerts";
import { PVS_DEAD_LETTER_QUEUE } from "@/lib/queues";

/**
 * Hourly PVS agent liveness scan (platform-wide, one job per tick).
 *
 * Covers the two failure modes a heartbeat cannot report about itself:
 *   * the agent stopped heartbeating entirely (nobody is left to tell us)
 *   * the agent heartbeats happily but no event has arrived in days
 *
 * Everything else is evaluated on the ingest path; see server/pvs-agent-health.ts
 * for the split and for the alert lifecycle. This processor owns exactly the
 * LIVENESS_SCOPE_KEYS, so it can never delete an ingest-owned alert.
 *
 * Scope: only clinics that HAVE a pvs_agent_status row. A Praxis that never
 * enrolled an agent has nothing to be silent about and must not be alerted on.
 *
 * Link-status filter: only a `connected` pvs_link is evaluated. The other
 * states are either "not live yet" (unconfigured, akkreditierung, pending) or
 * "deliberately not running" (disconnected), and `error` is already surfaced by
 * the link itself, so an added "agent silent" alert would be the same incident
 * twice. Non-connected clinics are NOT skipped outright though: they are
 * reconciled with an empty condition list, so an alert raised while the link
 * was connected clears as soon as the link leaves that state instead of
 * lingering forever.
 *
 * Self-healing: for connected clinics the scan also re-asserts the
 * heartbeat-scope alerts from the STORED health columns. The heartbeat route
 * writes those alerts best-effort and only when the health picture changes, so
 * one failed alert write would otherwise leave a real incident invisible until
 * the picture changes again.
 *
 * Failure semantics: every clinic is processed, then the job THROWS when any
 * clinic failed so pg-boss records the run as failed (and retries it) instead
 * of reporting a green run that reconciled nothing.
 *
 * Also checks the PVS dead-letter queue and emails ops when it holds jobs.
 */

export interface PvsAgentHealthScanJob {
  /** Unused; the scan is platform-wide. Present so the wrap() payload fits. */
  _?: never;
}

/** One agent row as read from the database. */
export interface AgentLivenessRow {
  clinicId: string;
  /** pvs_link.status, or null when the clinic has no link row at all. */
  linkStatus: string | null;
  lastHeartbeatAt: Date;
  lastEventAt: Date | null;
  /** pvs_agent_status.created_at: the stall clock for a never-delivered install. */
  agentFirstSeenAt: Date;
  /** pvs_agent_status.first_heartbeat_at; null = enrolled, never beaten. */
  firstHeartbeatAt?: Date | null;
  /** Stored heartbeat health slice, re-asserted hourly. Omitted = skip. */
  storedHealth?: {
    stalePendingEvents: number;
    missingFolders: string[];
    dbAdaptersFailed: string | null;
    adapterStatuses: AdapterStatusSnapshot[];
    clockSkewSeconds: number | null;
  };
}

/** The per-clinic outcome the scan hands to the reconciler. */
export interface AgentLivenessDecision {
  clinicId: string;
  conditions: AgentHealthCondition[];
  /** True when the link state made us skip evaluation (conditions stay empty). */
  skippedByLinkStatus: boolean;
}

/** Link states in which a silent agent is a real, actionable incident. */
export const LIVE_LINK_STATUSES: ReadonlySet<string> = new Set(["connected"]);

/**
 * Pure decision layer: rows in, per-clinic conditions out. Extracted so the
 * filtering and the "clear, do not evaluate" behaviour are testable without a
 * database. Every input row produces exactly one decision, because the
 * reconciler must run for each scanned clinic to resolve cleared alerts.
 */
export function planAgentLivenessScan(
  rows: readonly AgentLivenessRow[],
  now: Date
): AgentLivenessDecision[] {
  return rows.map((row) => {
    if (row.linkStatus === null || !LIVE_LINK_STATUSES.has(row.linkStatus)) {
      return { clinicId: row.clinicId, conditions: [], skippedByLinkStatus: true };
    }
    return {
      clinicId: row.clinicId,
      conditions: [
        ...evaluateAgentLiveness({
          lastHeartbeatAt: row.lastHeartbeatAt,
          lastEventAt: row.lastEventAt,
          agentFirstSeenAt: row.agentFirstSeenAt,
          firstHeartbeatAt: row.firstHeartbeatAt,
          now,
        }),
        ...(row.storedHealth ? evaluateHeartbeatHealth(row.storedHealth) : []),
      ],
      skippedByLinkStatus: false,
    };
  });
}

export async function processPvsAgentHealthScan(
  _job: PvsAgentHealthScanJob = {}
): Promise<void> {
  // Left join: an agent row without a link row is a broken enrollment, not a
  // reason to drop the clinic from reconciliation.
  const dbRows = await db
    .select({
      clinicId: schema.pvsAgentStatus.clinicId,
      linkStatus: schema.pvsLink.status,
      lastHeartbeatAt: schema.pvsAgentStatus.lastHeartbeatAt,
      lastEventAt: schema.pvsLink.lastEventAt,
      agentFirstSeenAt: schema.pvsAgentStatus.createdAt,
      firstHeartbeatAt: schema.pvsAgentStatus.firstHeartbeatAt,
      stalePendingEvents: schema.pvsAgentStatus.stalePendingEvents,
      missingFolders: schema.pvsAgentStatus.missingFolders,
      dbAdaptersFailed: schema.pvsAgentStatus.dbAdaptersFailed,
      adapterStatuses: schema.pvsAgentStatus.adapterStatuses,
      clockSkewSeconds: schema.pvsAgentStatus.clockSkewSeconds,
      uploadDiagnostics: schema.pvsAgentStatus.uploadDiagnostics,
    })
    .from(schema.pvsAgentStatus)
    .leftJoin(
      schema.pvsLink,
      eq(schema.pvsLink.clinicId, schema.pvsAgentStatus.clinicId)
    );

  const rows: AgentLivenessRow[] = dbRows.map((r) => ({
    clinicId: r.clinicId,
    linkStatus: r.linkStatus,
    lastHeartbeatAt: r.lastHeartbeatAt,
    lastEventAt: r.lastEventAt,
    agentFirstSeenAt: r.agentFirstSeenAt,
    firstHeartbeatAt: r.firstHeartbeatAt,
    storedHealth: {
      stalePendingEvents: r.stalePendingEvents,
      missingFolders: (r.missingFolders as string[] | null) ?? [],
      dbAdaptersFailed: r.dbAdaptersFailed,
      adapterStatuses: (r.adapterStatuses as AdapterStatusSnapshot[] | null) ?? [],
      clockSkewSeconds: r.clockSkewSeconds,
      // Same reason the heartbeat path rendered, so the hourly scan does not
      // overwrite the specific backlog text with the generic one.
      uploadReason: deriveUploadReason(r.uploadDiagnostics as UploadDiagnostics | null),
    },
  }));

  const decisions = planAgentLivenessScan(rows, new Date());

  let raised = 0;
  let failed = 0;
  for (const d of decisions) {
    // One bad clinic must not abort the scan for the rest.
    try {
      // Non-connected clinics only get their liveness alerts cleared; the
      // heartbeat-scope alerts are re-asserted only where the link is live.
      await reconcileAgentHealthAlerts(
        d.clinicId,
        d.conditions,
        d.skippedByLinkStatus
          ? LIVENESS_SCOPE_KEYS
          : [...LIVENESS_SCOPE_KEYS, ...HEARTBEAT_SCOPE_KEYS]
      );
      raised += d.conditions.length;
    } catch (err) {
      failed += 1;
      console.error(
        `[pvs-agent-health-scan] clinic ${d.clinicId} failed:`,
        err
      );
    }
  }

  const skipped = decisions.filter((d) => d.skippedByLinkStatus).length;
  console.log(
    `[pvs-agent-health-scan] scanned ${decisions.length} clinics ` +
      `(${skipped} not connected), ${raised} conditions raised, ` +
      `${failed}/${decisions.length} failed`
  );

  await checkDeadLetterQueue();

  if (failed > 0) {
    throw new Error(
      `pvs-agent-health-scan: ${failed}/${decisions.length} clinics failed`
    );
  }
}

/** Jobs dead-lettered in the last 7 days (-1 when unreadable). */
export async function countDeadLetterJobs(): Promise<number> {
  try {
    const rows = (await db.execute(
      sql`SELECT count(*)::int AS n FROM pgboss.job
          WHERE name = ${PVS_DEAD_LETTER_QUEUE} AND state = 'created'
            AND created_on > now() - interval '7 days'`
    )) as unknown as Array<{ n: number }>;
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.error("[pvs-agent-health-scan] dead-letter count failed:", err);
    return -1;
  }
}

async function checkDeadLetterQueue(): Promise<void> {
  const n = await countDeadLetterJobs();
  if (n <= 0) return;
  await notifyOps({
    clinicId: null,
    kind: "pvs_dead_letter",
    severity: "high",
    title: `PVS-Job-Warteschlange: ${n} Job${n > 1 ? "s" : ""} endgültig fehlgeschlagen`,
    body:
      `In der Dead-Letter-Queue ${PVS_DEAD_LETTER_QUEUE} liegen ${n} Jobs, die ` +
      "alle Wiederholungen aufgebraucht haben (derive, link-backfill, reconcile ...). " +
      "Die zugehörigen Praxis-Daten sind möglicherweise veraltet. Jobs ansehen: " +
      `SELECT name, data, output FROM pgboss.job WHERE name = '${PVS_DEAD_LETTER_QUEUE}'.`,
  });
}
