import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { ALL_RULES, combineMultiSignal } from "../anomaly/rules";
import { enrichWithAi } from "../anomaly/enrich";
import type { AlertCandidate } from "../anomaly/types";

/**
 * Anomaly-scan worker. Runs every 6 hours per cron schedule.
 *
 * For each clinic (or the one in `job.clinicId`):
 *   1. Run all rules → AlertCandidate[].
 *   2. Combine multi-signal patterns (e.g. CPL surge + revenue drop both
 *      get bumped to "extreme" and become AI-enrichment-eligible).
 *   3. Upsert each candidate into dashboard_alerts, keyed on
 *      (clinic_id, dedupe_key). On first detection, INSERT; on subsequent
 *      detections of the SAME anomaly, refresh observed_value + updated_at
 *      but leave dismissed_at and snoozed_until untouched.
 *   4. Auto-clear: any non-dismissed alert whose dedupe_key was NOT
 *      produced this run gets stamped dismissed_at = now() so the widget
 *      doesn't show stale anomalies the metrics already recovered from.
 *   5. For candidates flagged `aiEnrich`, call the LLM enricher and
 *      persist the result. Only NEW alerts or those without prior AI
 *      output get a fresh call (no spend on every run).
 */

export interface AnomalyScanJob {
  clinicId?: string;
}

export async function processAnomalyScan(
  job: AnomalyScanJob = {}
): Promise<void> {
  const clinicRows = job.clinicId
    ? [{ id: job.clinicId }]
    : await db
        .select({ id: schema.clinics.id })
        .from(schema.clinics)
        .where(isNull(schema.clinics.archivedAt));

  for (const c of clinicRows) {
    await scanClinic(c.id);
  }
}

async function scanClinic(clinicId: string): Promise<void> {
  // 1. Run rules.
  let candidates: AlertCandidate[] = [];
  for (const rule of ALL_RULES) {
    try {
      const out = await rule(clinicId);
      candidates.push(...out);
    } catch (err) {
      console.error(`[anomaly-scan] rule failed for ${clinicId}:`, err);
    }
  }

  // 2. Multi-signal combiner.
  candidates = combineMultiSignal(candidates);

  // 3. Look up existing rows so we know whether to call AI fresh.
  const existing = await db
    .select({
      id: schema.dashboardAlerts.id,
      dedupeKey: schema.dashboardAlerts.dedupeKey,
      aiActionSteps: schema.dashboardAlerts.aiActionSteps,
      severity: schema.dashboardAlerts.severity,
      dismissedAt: schema.dashboardAlerts.dismissedAt,
    })
    .from(schema.dashboardAlerts)
    .where(eq(schema.dashboardAlerts.clinicId, clinicId));

  const existingByKey = new Map(existing.map((r) => [r.dedupeKey, r]));
  const producedKeys = new Set<string>();

  // 4. Upsert candidates.
  for (const cand of candidates) {
    producedKeys.add(cand.dedupeKey);
    const prior = existingByKey.get(cand.dedupeKey);

    // Decide whether we need a fresh AI call. Cheapest path: reuse the
    // prior LLM output when severity hasn't escalated. Otherwise enrich.
    let aiSteps: string[] | null = prior?.aiActionSteps ?? null;
    const severityEscalated =
      prior != null && severityRank(cand.severity) > severityRank(prior.severity);

    if (cand.aiEnrich && (aiSteps == null || severityEscalated)) {
      const enriched = await enrichWithAi(cand);
      // Distinguish "ran but produced nothing" (= []) from "did not run"
      // (= null). The widget treats null as "no AI sauce attempted" and
      // an empty array as "AI ran, had nothing extra to say".
      aiSteps = enriched;
    }

    const values = {
      clinicId,
      kind: cand.kind,
      severity: cand.severity,
      title: cand.title,
      body: cand.body,
      actionSteps: cand.defaultActionSteps,
      aiActionSteps: aiSteps,
      metric: cand.metric ?? null,
      baselineValue:
        cand.baselineValue != null ? cand.baselineValue.toString() : null,
      observedValue:
        cand.observedValue != null ? cand.observedValue.toString() : null,
      dedupeKey: cand.dedupeKey,
      updatedAt: new Date(),
    };

    await db
      .insert(schema.dashboardAlerts)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.dashboardAlerts.clinicId,
          schema.dashboardAlerts.dedupeKey,
        ],
        set: {
          severity: values.severity,
          title: values.title,
          body: values.body,
          actionSteps: values.actionSteps,
          aiActionSteps: values.aiActionSteps,
          metric: values.metric,
          baselineValue: values.baselineValue,
          observedValue: values.observedValue,
          updatedAt: values.updatedAt,
          // On re-detection of a previously dismissed alert: leave
          // dismissed_at as-is. The praxis chose to hide it; we don't
          // un-hide on the same dedupe_key. (If a new anomaly arises,
          // the rule must choose a different dedupe_key suffix.)
        },
      });
  }

  // 5. Auto-clear: anomalies that didn't reproduce → mark dismissed.
  // This is the "self-heals" path: if no-show-rate recovered, the
  // no_show_spike rule won't fire and the previously-active alert here
  // gets cleared so the widget reflects current reality.
  const stale = existing.filter(
    (r) => r.dismissedAt == null && !producedKeys.has(r.dedupeKey)
  );
  if (stale.length > 0) {
    await db
      .update(schema.dashboardAlerts)
      .set({ dismissedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.dashboardAlerts.clinicId, clinicId),
          inArray(
            schema.dashboardAlerts.id,
            stale.map((r) => r.id)
          ),
          isNull(schema.dashboardAlerts.dismissedAt)
        )
      );
  }
}

function severityRank(s: string): number {
  switch (s) {
    case "info":
      return 0;
    case "warn":
      return 1;
    case "high":
      return 2;
    case "extreme":
      return 3;
    default:
      return -1;
  }
}
