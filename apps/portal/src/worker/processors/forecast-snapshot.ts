import { sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { loadForecastInputs } from "@/server/queries/forecast";
import { runForecast, MIN_SAMPLE_WON } from "@/server/forecast/engine";

/**
 * Nightly per-praxis forecast snapshot worker.
 *
 * Runs after `kpi-rebuild` (03:00 UTC) so the rates and inputs reflect
 * yesterday's closed deals. For each praxis with at least MIN_SAMPLE_WON
 * historical wins, we run the Monte Carlo and upsert one row into
 * `forecast_snapshots` keyed on (clinic_id, snapshot_date).
 *
 * Praxen with too few wins still get a row written (with empty buckets +
 * zero KPIs) so the UI can deterministically distinguish "gate active"
 * from "snapshot stale / missing".
 */

export interface ForecastSnapshotJob {
  clinicId: string;
  /** Optional override; defaults to today's date in UTC. */
  snapshotDate?: string;
}

export async function processForecastSnapshot(
  job: ForecastSnapshotJob
): Promise<void> {
  const { clinicId } = job;
  const snapshotDate = job.snapshotDate ?? new Date().toISOString().slice(0, 10);

  const inputs = await loadForecastInputs(clinicId);

  // Cold-start: persist a "gate" row instead of skipping. UI then has a
  // stable signal ("snapshot exists, sample too small") vs. "snapshot
  // missing entirely" (worker hasn't run yet).
  if (inputs.totalWon < MIN_SAMPLE_WON) {
    await db
      .insert(schema.forecastSnapshots)
      .values({
        clinicId,
        snapshotDate,
        horizonDays: 90,
        weeklyBuckets: [],
        topKpis: {
          pipelineValueEur: 0,
          expectedBooked30dEur: 0,
          expectedBooked60dEur: 0,
          expectedBooked90dEur: 0,
          expectedPaid30dEur: 0,
          expectedPaid60dEur: 0,
          expectedPaid90dEur: 0,
        },
        sampleSizeWon: inputs.totalWon,
        openRequestCount: 0,
        excludedRequestCount: 0,
      })
      .onConflictDoUpdate({
        target: [
          schema.forecastSnapshots.clinicId,
          schema.forecastSnapshots.snapshotDate,
        ],
        set: {
          weeklyBuckets: [],
          topKpis: sql`excluded.top_kpis`,
          sampleSizeWon: inputs.totalWon,
          openRequestCount: 0,
          excludedRequestCount: 0,
        },
      });
    return;
  }

  const result = runForecast(inputs);

  await db
    .insert(schema.forecastSnapshots)
    .values({
      clinicId,
      snapshotDate,
      horizonDays: 90,
      weeklyBuckets: result.weeklyBuckets,
      topKpis: result.topKpis,
      sampleSizeWon: inputs.totalWon,
      openRequestCount: result.forecastedRequestCount,
      excludedRequestCount: result.excludedRequestCount,
    })
    .onConflictDoUpdate({
      target: [
        schema.forecastSnapshots.clinicId,
        schema.forecastSnapshots.snapshotDate,
      ],
      set: {
        weeklyBuckets: result.weeklyBuckets,
        topKpis: result.topKpis,
        sampleSizeWon: inputs.totalWon,
        openRequestCount: result.forecastedRequestCount,
        excludedRequestCount: result.excludedRequestCount,
      },
    });
}
