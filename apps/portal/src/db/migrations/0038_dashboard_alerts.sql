-- Dashboard anomaly alerts: surfaced in the /dashboard "Auffälligkeiten"
-- widget. Each row is one currently-active anomaly for a praxis, produced
-- by the anomaly-scan worker (every 6h). Rule-based detection writes the
-- defaults; the AI enrichment column is only populated for the rare
-- "outlier or multi-signal" cases where rules alone would produce a too-
-- generic action step.
--
-- Lifecycle:
--   anomaly-scan inserts on first detection (dedupe_key uniqueness keeps
--     repeated detections from spamming the widget).
--   anomaly-scan auto-clears (dismissed_at = now()) rows whose underlying
--     metric has returned to baseline on the next run, so the praxis
--     doesn't have to dismiss self-healing alerts manually.
--   The praxis can also dismiss (hide forever) or snooze (hide for 7 days)
--     via server actions.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS dashboard_alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Rule slug. New rules add new kinds; the widget renders any kind so we
  -- don't gate on an enum. Currently produced: no_show_spike, cpl_surge,
  -- lead_drought, revenue_drop, sla_breach_trend.
  kind              text NOT NULL,
  -- info | warn | high | extreme. "extreme" is the only severity that may
  -- trigger AI enrichment (see worker/anomaly/enrich.ts).
  severity          text NOT NULL,
  title             text NOT NULL,
  body              text NOT NULL,
  -- Default action steps from the rule. Empty array when actionRequired
  -- was false (e.g. info-only alert that's already self-correcting).
  action_steps      jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Extra tailored steps from the LLM. NULL means enrichment did not run
  -- (rule's default steps were judged sufficient); an empty array means
  -- enrichment ran but produced nothing usable.
  ai_action_steps   text[],
  -- Which metric triggered the alert. Used to render context line + chart
  -- link. Free-form so new rules can introduce new metric ids without a
  -- schema change.
  metric            text,
  baseline_value    numeric(14, 4),
  observed_value    numeric(14, 4),
  -- Stable key for "the same anomaly". Lets the scan worker upsert on
  -- re-detection (don't create duplicates) and lets dismiss/snooze persist
  -- across re-runs. Convention: <kind>:<sub-id-or-period> e.g.
  -- "cpl_surge:meta:campaign-xyz" or "lead_drought:rolling-14d".
  dedupe_key        text NOT NULL,
  snoozed_until     timestamptz,
  dismissed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dashboard_alerts_severity_check
    CHECK (severity IN ('info','warn','high','extreme'))
);

-- One active alert per (clinic, dedupe_key). The scan worker upserts on
-- this; dismiss/snooze don't drop rows, they just stamp the lifecycle
-- columns.
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_alerts_dedupe_unique
  ON dashboard_alerts (clinic_id, dedupe_key);

-- Hot read path: the dashboard widget fetches the active set for the
-- current praxis sorted by severity then recency. Filter the index to
-- non-dismissed rows so the read scans a fraction of history.
CREATE INDEX IF NOT EXISTS dashboard_alerts_active_idx
  ON dashboard_alerts (clinic_id, created_at DESC)
  WHERE dismissed_at IS NULL;

-- ============================================================
-- RLS: tenant-scoped, same pattern as 0037.
-- ============================================================
ALTER TABLE dashboard_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboard_alerts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_alerts_tenant ON dashboard_alerts;
CREATE POLICY dashboard_alerts_tenant ON dashboard_alerts
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());
