-- Phase 4: per-stream PVS health surface.
--
-- The SQL-introspection framework (apps/bridge/agent/src/db-adapters/
-- framework.ts) detects schema drift on every poll. When a Praxis-side PVS
-- vendor update renames a column, the framework halts that stream only and
-- emits a signed LinkHealth event to /api/pvs/health. We persist one row
-- per (clinic, vendor, stream_kind, detected_at); we update resolved_at
-- when the agent later reports the column shape recovered.
--
-- The integrations UI (apps/portal/src/app/(portal)/einstellungen/
-- integrationen/page.tsx) reads unresolved rows to render the per-stream
-- drift warning card the Phase 4 brief requires.
--
-- This is also the surface for non-drift transient errors that exceed the
-- in-agent fail threshold (status='error'). The shape is intentionally
-- generic so future health signals (auth_expired, connection_lost,
-- rate_limited) reuse it without another migration.

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_link_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_vendor text NOT NULL,
  bridge_source text NOT NULL,
  stream_kind text NOT NULL,
  event_kind text NOT NULL,
  severity text NOT NULL DEFAULT 'warn',
  message text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution_note text,
  received_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pvs_link_health
  ADD CONSTRAINT pvs_link_health_event_kind_check
  CHECK (event_kind IN (
    'schema_drift',
    'schema_recovered',
    'stream_error',
    'stream_recovered',
    'auth_expired',
    'connection_lost',
    'rate_limited'
  ));

ALTER TABLE pvs_link_health
  ADD CONSTRAINT pvs_link_health_severity_check
  CHECK (severity IN ('info', 'warn', 'error'));

ALTER TABLE pvs_link_health
  ADD CONSTRAINT pvs_link_health_stream_kind_check
  CHECK (stream_kind IN (
    'PatientUpserted',
    'AppointmentCreated',
    'AppointmentStatusChanged',
    'AppointmentCancelled',
    'EncounterCompleted',
    'InvoicePaid',
    'RecallScheduled',
    'PatientMerged',
    -- A vendor-wide event (auth failure, base-URL unreachable) is not
    -- attached to a specific stream. Adapters emit 'vendor' as a stand-in.
    'vendor'
  ));

ALTER TABLE pvs_link_health
  ADD CONSTRAINT pvs_link_health_bridge_source_check
  CHECK (bridge_source IN (
    'tomedo',
    'healthhub',
    'red',
    'pabau',
    'consentz',
    'gdt_agent',
    'csv_upload',
    'n8n_custom'
  ));

-- Idempotent ingest: the agent retries until a 2xx; the dedup key is the
-- (clinic, vendor, stream, event_kind, detected_at) tuple so a retried POST
-- is a no-op rather than a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS pvs_link_health_dedup_idx
  ON pvs_link_health (clinic_id, pvs_vendor, stream_kind, event_kind, detected_at);

-- Hot path for the integrations page: "list unresolved health for this clinic".
CREATE INDEX IF NOT EXISTS pvs_link_health_open_idx
  ON pvs_link_health (clinic_id, resolved_at, detected_at DESC)
  WHERE resolved_at IS NULL;

-- Hot path for ops dashboards: "all open drift across all clinics".
CREATE INDEX IF NOT EXISTS pvs_link_health_drift_open_idx
  ON pvs_link_health (event_kind, resolved_at, detected_at DESC)
  WHERE event_kind = 'schema_drift' AND resolved_at IS NULL;

-- ============================================================
-- Row-Level Security: mirrors 0031_rls_pvs.sql.
-- ============================================================
ALTER TABLE pvs_link_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE pvs_link_health FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvs_link_health_tenant ON pvs_link_health;
CREATE POLICY pvs_link_health_tenant ON pvs_link_health
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());
