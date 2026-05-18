-- PVS Bridge — per-Praxis link record.
--
-- One row per clinic (UNIQUE) representing the active PVS connection. The
-- `connection_config` jsonb stores vendor-specific config (Tomedo OAuth
-- endpoint, HealthHub subscription id, RED tenant id, GDT agent host,
-- CSV-only flag, etc.) without forcing a schema-per-vendor explosion.
--
-- Status lifecycle:
--   'unconfigured'    — clinic exists but hasn't started setup
--   'akkreditierung'  — medatixx-HealthHub access requested, awaiting approval
--   'pending'         — credentials provided, awaiting first successful sync
--   'connected'       — active, syncing
--   'error'           — N consecutive failures; bridge stops polling until
--                       clinic re-authenticates (see pvs_sync_status)
--   'disconnected'    — clinic deliberately disconnected (data retained)

SET statement_timeout = 0;
SET lock_timeout = 0;

CREATE TABLE IF NOT EXISTS pvs_link (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  pvs_vendor          text NOT NULL,
  status              text NOT NULL DEFAULT 'unconfigured',
  connection_config   jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_event_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pvs_link_clinic_unique UNIQUE (clinic_id),
  CONSTRAINT pvs_link_vendor_check CHECK (
    pvs_vendor IN ('tomedo','healthhub','red','gdt_agent','csv_upload','n8n_custom','none')
  ),
  CONSTRAINT pvs_link_status_check CHECK (
    status IN ('unconfigured','akkreditierung','pending','connected','error','disconnected')
  )
);

CREATE INDEX IF NOT EXISTS pvs_link_status_idx ON pvs_link(status);
CREATE INDEX IF NOT EXISTS pvs_link_vendor_idx ON pvs_link(pvs_vendor);
