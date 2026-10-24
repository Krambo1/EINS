import { NextResponse } from "next/server";
import { and, desc, isNull, like, or, lte, sql } from "drizzle-orm";
import { requireAdminForApi } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  WORKER_BEAT_NAME,
  getLastBeat,
  isWorkerStale,
} from "@/server/worker-heartbeat";

/**
 * Admin-only cross-clinic view of every open PVS alert.
 *
 * dashboard_alerts rows are otherwise visible only to the affected Praxis's
 * own users (max 5). This lists them for EINS operators across all clinics,
 * highest severity first, plus the worker's liveness.
 *
 * "Open" = kind starts with `pvs_`, not dismissed, not snoozed.
 * Read-only; resolving happens at the source (the condition clearing).
 */

export const dynamic = "force-dynamic";

const SEVERITY_RANK = sql`CASE ${schema.dashboardAlerts.severity}
  WHEN 'extreme' THEN 0 WHEN 'high' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END`;

export async function GET() {
  const gate = await requireAdminForApi();
  if (!gate.ok) return gate.response;

  const now = new Date();
  const rows = await db
    .select({
      id: schema.dashboardAlerts.id,
      clinicId: schema.dashboardAlerts.clinicId,
      clinicName: schema.clinics.displayName,
      kind: schema.dashboardAlerts.kind,
      dedupeKey: schema.dashboardAlerts.dedupeKey,
      severity: schema.dashboardAlerts.severity,
      title: schema.dashboardAlerts.title,
      metric: schema.dashboardAlerts.metric,
      observedValue: schema.dashboardAlerts.observedValue,
      createdAt: schema.dashboardAlerts.createdAt,
      updatedAt: schema.dashboardAlerts.updatedAt,
    })
    .from(schema.dashboardAlerts)
    .innerJoin(
      schema.clinics,
      sql`${schema.clinics.id} = ${schema.dashboardAlerts.clinicId}`
    )
    .where(
      and(
        like(schema.dashboardAlerts.kind, "pvs\_%"),
        isNull(schema.dashboardAlerts.dismissedAt),
        or(
          isNull(schema.dashboardAlerts.snoozedUntil),
          lte(schema.dashboardAlerts.snoozedUntil, now)
        )
      )
    )
    .orderBy(SEVERITY_RANK, desc(schema.dashboardAlerts.updatedAt))
    .limit(500);

  const lastBeat = await getLastBeat(WORKER_BEAT_NAME);

  return NextResponse.json(
    {
      alerts: rows,
      count: rows.length,
      worker: {
        lastBeatAt: lastBeat ? lastBeat.toISOString() : null,
        stale: isWorkerStale(lastBeat, now),
      },
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
