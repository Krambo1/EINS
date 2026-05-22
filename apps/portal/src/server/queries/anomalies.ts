import "server-only";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { withClinicContext, schema } from "@/db/client";

/**
 * Anomaly-alert queries. Reads through `withClinicContext` so RLS guards
 * against any cross-tenant leak. Writes (dismiss/snooze) live in the
 * actions file next to the widget; the scan worker upserts via the
 * superuser connection in `worker/processors/anomaly-scan.ts`.
 */

export type AlertSeverity = "info" | "warn" | "high" | "extreme";

export interface DashboardAlert {
  id: string;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string;
  /** Default rule action steps. Empty = no action required. */
  actionSteps: string[];
  /** LLM-added steps. null = not enriched. */
  aiActionSteps: string[] | null;
  metric: string | null;
  baselineValue: number | null;
  observedValue: number | null;
  createdAt: Date;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  extreme: 3,
  high: 2,
  warn: 1,
  info: 0,
};

/**
 * Active alerts for the dashboard widget. "Active" = not dismissed and
 * not currently snoozed. Sorted by severity (extreme first) then recency.
 * Capped at `limit` rows so the widget never explodes; the brief asks for
 * "drei bis fünf Zeilen pro Woche".
 */
export async function getActiveAlerts(
  clinicId: string,
  userId: string,
  limit = 5
): Promise<DashboardAlert[]> {
  const rows = await withClinicContext(clinicId, userId, async (tx) => {
    return await tx
      .select()
      .from(schema.dashboardAlerts)
      .where(
        and(
          isNull(schema.dashboardAlerts.dismissedAt),
          or(
            isNull(schema.dashboardAlerts.snoozedUntil),
            sql`${schema.dashboardAlerts.snoozedUntil} < now()`
          )
        )
      )
      .orderBy(desc(schema.dashboardAlerts.createdAt));
  });

  return rows
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity as AlertSeverity,
      title: r.title,
      body: r.body,
      actionSteps: parseActionSteps(r.actionSteps),
      aiActionSteps: r.aiActionSteps ?? null,
      metric: r.metric ?? null,
      baselineValue: r.baselineValue != null ? Number(r.baselineValue) : null,
      observedValue: r.observedValue != null ? Number(r.observedValue) : null,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => {
      const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (sd !== 0) return sd;
      return b.createdAt.getTime() - a.createdAt.getTime();
    })
    .slice(0, limit);
}

function parseActionSteps(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      /* fall through */
    }
  }
  return [];
}

/** Internal: assert an alert belongs to the clinic before mutating. */
export async function assertAlertOwned(
  alertId: string,
  clinicId: string,
  userId: string
): Promise<boolean> {
  return await withClinicContext(clinicId, userId, async (tx) => {
    const [row] = await tx
      .select({ id: schema.dashboardAlerts.id })
      .from(schema.dashboardAlerts)
      .where(eq(schema.dashboardAlerts.id, alertId))
      .limit(1);
    return !!row;
  });
}
