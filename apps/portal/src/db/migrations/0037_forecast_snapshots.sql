-- Forecast snapshots — nightly precomputed cashflow projections per praxis.
--
-- One row per (clinic_id, snapshot_date). The 13-week weekly buckets plus
-- top-level KPIs are serialized as jsonb so the engine can evolve its
-- output shape without a migration; the typed columns are just the few
-- fields we need to filter / sort on cheaply (most recent snapshot, gated
-- by sample size).
--
-- Cold-start gate: rows are only written for clinics with
-- sample_size_won >= 30. UI checks `sample_size_won` to decide between the
-- gate empty state and the rendered chart.
--
-- Dual cash series ("booked" = won at wonAt; "paid" = InvoicePaid at
-- paidAt = wonAt + DSO) lives inside `weekly_buckets` per the engine spec.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS forecast_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  snapshot_date     date NOT NULL,
  horizon_days      integer NOT NULL DEFAULT 90,
  -- Engine output. See src/server/forecast/engine.ts for the exact shape:
  --   weekly_buckets: { weekStart: 'YYYY-MM-DD',
  --                     booked: { p10, p50, p90 },
  --                     paid:   { p10, p50, p90 } }[]
  weekly_buckets    jsonb NOT NULL,
  -- Top-line numbers shown above the chart. Pulled into typed access via
  -- jsonb extraction in queries that only need the KPIs:
  --   { pipelineValueEur, expectedCash30dEur, expectedCash60dEur, expectedCash90dEur }
  top_kpis          jsonb NOT NULL,
  -- Cold-start gating + UI confidence-band width. <30 is hidden by the UI.
  sample_size_won   integer NOT NULL,
  -- Number of open requests that contribute to the forecast (excluding
  -- those whose treatment has no won history — those are surfaced
  -- separately by the UI).
  open_request_count        integer NOT NULL DEFAULT 0,
  -- Open requests excluded because their treatment_id has zero won-history
  -- (treatment-level cold-start). UI surfaces this as "N nicht prognostiziert".
  excluded_request_count    integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT forecast_snapshots_horizon_check
    CHECK (horizon_days BETWEEN 7 AND 365),
  CONSTRAINT forecast_snapshots_sample_check
    CHECK (sample_size_won >= 0)
);

-- One snapshot per clinic per day. Re-running the worker upserts.
CREATE UNIQUE INDEX IF NOT EXISTS forecast_snapshots_clinic_date_unique
  ON forecast_snapshots (clinic_id, snapshot_date);

-- Latest-snapshot read path: ORDER BY snapshot_date DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS forecast_snapshots_latest_idx
  ON forecast_snapshots (clinic_id, snapshot_date DESC);

-- ============================================================
-- RLS — tenant-scoped, same pattern as 0036.
-- ============================================================
ALTER TABLE forecast_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecast_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS forecast_snapshots_tenant ON forecast_snapshots;
CREATE POLICY forecast_snapshots_tenant ON forecast_snapshots
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());
