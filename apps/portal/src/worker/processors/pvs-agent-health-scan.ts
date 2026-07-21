import { eq } from "drizzle-orm";
import { db, schema } from "@/db/client";
import {
  evaluateAgentLiveness,
  reconcileAgentHealthAlerts,
  LIVENESS_SCOPE_KEYS,
  type AgentHealthCondition,
} from "@/server/pvs-agent-health";

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
      conditions: evaluateAgentLiveness({
        lastHeartbeatAt: row.lastHeartbeatAt,
        lastEventAt: row.lastEventAt,
        agentFirstSeenAt: row.agentFirstSeenAt,
        now,
      }),
      skippedByLinkStatus: false,
    };
  });
}

export async function processPvsAgentHealthScan(
  _job: PvsAgentHealthScanJob = {}
): Promise<void> {
  // Left join: an agent row without a link row is a broken enrollment, not a
  // reason to drop the clinic from reconciliation.
  const rows: AgentLivenessRow[] = await db
    .select({
      clinicId: schema.pvsAgentStatus.clinicId,
      linkStatus: schema.pvsLink.status,
      lastHeartbeatAt: schema.pvsAgentStatus.lastHeartbeatAt,
      lastEventAt: schema.pvsLink.lastEventAt,
      agentFirstSeenAt: schema.pvsAgentStatus.createdAt,
    })
    .from(schema.pvsAgentStatus)
    .leftJoin(
      schema.pvsLink,
      eq(schema.pvsLink.clinicId, schema.pvsAgentStatus.clinicId)
    );

  const decisions = planAgentLivenessScan(rows, new Date());

  let raised = 0;
  let failed = 0;
  for (const d of decisions) {
    // One bad clinic must not abort the scan for the rest.
    try {
      await reconcileAgentHealthAlerts(d.clinicId, d.conditions, LIVENESS_SCOPE_KEYS);
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
      `(${skipped} not connected), ${raised} conditions raised, ${failed} errors`
  );
}
