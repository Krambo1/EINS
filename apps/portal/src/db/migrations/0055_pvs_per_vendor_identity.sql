-- 0055_pvs_per_vendor_identity.sql
--
-- Phase 7: per-vendor identity (portal side).
--
-- Each PVS engine the on-prem agent reads becomes a first-class provenance.
-- We keep exactly one pvs_link per clinic (many readers depend on that 1:1),
-- and add pvs_link_source: the SET of bridge_sources a clinic is allowed to
-- emit. The HMAC signature already authenticates the clinic; bridge_source is
-- now a provenance label, not an auth boundary, so applyPvsEvent demotes the
-- old vendor_mismatch hard-fail to a membership check against this table.
--
-- Three CHECKs gain the 7 per-Praxis DB-read vendors (underscores; CGM-M1
-- Postgres and Oracle both collapse to cgm_m1pro):
--   medatixx, cgm_albis, cgm_turbomed, cgm_m1pro, indamed, quincy, pixelmedics
--
--   1) pvs_event_log.bridge_source  — RANGE-partitioned, ~30M rows projected.
--      Re-issue NOT VALID so the additive widening skips the full-scan
--      ACCESS EXCLUSIVE validation (no existing row can violate a CHECK that
--      only ADDS allowed values; NOT VALID still enforces it on every new
--      insert). Re-issue on the PARENT only; Postgres 12+ cascades to all
--      partitions. Never hand-alter the pvs_event_log_YYYY_MM children.
--   2) pvs_link.pvs_vendor          — small table, plain DROP + ADD.
--   3) pvs_link_source.bridge_source — the new table's own CHECK.
--
-- Ordering note: pvs_link_source is created and BACKFILLED before RLS is
-- enabled. With FORCE ROW LEVEL SECURITY a backfill that runs as the table
-- owner would be filtered by the tenant policy (app_current_clinic() is NULL
-- during a migration), silently inserting zero rows. Backfilling first sides
-- steps that regardless of which role applies the migration.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- 1) pvs_event_log.bridge_source — partitioned, NOT VALID.
-- ============================================================
ALTER TABLE pvs_event_log
  DROP CONSTRAINT IF EXISTS pvs_event_log_bridge_source_check;

ALTER TABLE pvs_event_log
  ADD CONSTRAINT pvs_event_log_bridge_source_check CHECK (
    bridge_source IN (
      'tomedo',
      'healthhub',
      'red',
      'pabau',
      'consentz',
      'gdt_agent',
      'csv_upload',
      'n8n_custom',
      'medatixx',
      'cgm_albis',
      'cgm_turbomed',
      'cgm_m1pro',
      'indamed',
      'quincy',
      'pixelmedics'
    )
  ) NOT VALID;

-- ============================================================
-- 2) pvs_link.pvs_vendor — small table, plain DROP + ADD.
-- ============================================================
ALTER TABLE pvs_link
  DROP CONSTRAINT IF EXISTS pvs_link_vendor_check;

ALTER TABLE pvs_link
  ADD CONSTRAINT pvs_link_vendor_check CHECK (
    pvs_vendor IN (
      'tomedo',
      'healthhub',
      'red',
      'pabau',
      'consentz',
      'gdt_agent',
      'csv_upload',
      'n8n_custom',
      'none',
      'medatixx',
      'cgm_albis',
      'cgm_turbomed',
      'cgm_m1pro',
      'indamed',
      'quincy',
      'pixelmedics'
    )
  );

-- ============================================================
-- 3) pvs_link_source — the set of bridge_sources a clinic may emit.
-- ============================================================
-- PK (clinic_id, bridge_source): one row per (Praxis, provenance). The
-- pvs_vendor column records which clinic-vendor the source belongs to (for
-- the DB-read engines and gdt_agent it equals bridge_source). enrolled_via
-- traces how the row appeared: 'enrollment' (GDT agent redemption seed),
-- 'heartbeat' (agent self-report), 'backfill' (this migration), 'manual'.
CREATE TABLE IF NOT EXISTS pvs_link_source (
  clinic_id      uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  bridge_source  text NOT NULL,
  pvs_vendor     text NOT NULL,
  enrolled_via   text NOT NULL DEFAULT 'heartbeat',
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, bridge_source),
  CONSTRAINT pvs_link_source_bridge_source_check CHECK (
    bridge_source IN (
      'tomedo',
      'healthhub',
      'red',
      'pabau',
      'consentz',
      'gdt_agent',
      'csv_upload',
      'n8n_custom',
      'medatixx',
      'cgm_albis',
      'cgm_turbomed',
      'cgm_m1pro',
      'indamed',
      'quincy',
      'pixelmedics'
    )
  ),
  CONSTRAINT pvs_link_source_enrolled_via_check CHECK (
    enrolled_via IN ('enrollment', 'heartbeat', 'backfill', 'manual')
  )
);

-- No standalone clinic_id index: the PK (clinic_id, bridge_source) already
-- indexes clinic_id as its leftmost prefix, and every read filters by
-- clinic_id (admin set view) or the full PK (membership check / upserts).

-- ============================================================
-- 4) Backfill from existing pvs_link so current clinics keep emitting.
-- ============================================================
-- Each clinic's current vendor becomes an allowed source. Skip the
-- non-emitting sentinel ('none') and the universal sources (csv_upload /
-- n8n_custom are accepted for any clinic without a row, and csv_upload is
-- never accepted over the wire anyway). Runs BEFORE RLS is enabled (see
-- header note).
INSERT INTO pvs_link_source (clinic_id, bridge_source, pvs_vendor, enrolled_via)
  SELECT clinic_id, pvs_vendor, pvs_vendor, 'backfill'
  FROM pvs_link
  WHERE pvs_vendor NOT IN ('none', 'csv_upload', 'n8n_custom')
  ON CONFLICT (clinic_id, bridge_source) DO NOTHING;

-- ============================================================
-- 5) Row-Level Security — mirror 0031_rls_pvs.sql (clinic_id is direct).
-- ============================================================
ALTER TABLE pvs_link_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE pvs_link_source FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvs_link_source_tenant ON pvs_link_source;
CREATE POLICY pvs_link_source_tenant ON pvs_link_source
  USING (clinic_id = app_current_clinic())
  WITH CHECK (clinic_id = app_current_clinic());
