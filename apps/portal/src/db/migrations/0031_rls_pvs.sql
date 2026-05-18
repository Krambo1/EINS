-- PVS Bridge — Row-Level Security for all new clinic-scoped tables.
-- Mirrors the pattern in 0002_rls.sql verbatim.
--
-- Tables enabled here:
--   pvs_link, pvs_event_log (and all partitions), pvs_patient_map,
--   pvs_treatment_mapping, pvs_location_mapping, pvs_sync_status,
--   linking_failures, pvs_csv_uploads, pvs_agent_enrollment_tokens
--
-- pvs_sync_status is scoped via JOIN to pvs_link (no clinic_id column).

SET statement_timeout = 0;
SET lock_timeout = 0;

-- ============================================================
-- Simple tenant-scoped tables (have clinic_id directly).
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'pvs_link',
      'pvs_event_log',
      'pvs_patient_map',
      'pvs_treatment_mapping',
      'pvs_location_mapping',
      'linking_failures',
      'pvs_csv_uploads',
      'pvs_agent_enrollment_tokens'
    ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I;', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (clinic_id = app_current_clinic()) WITH CHECK (clinic_id = app_current_clinic());',
      t || '_tenant', t
    );
  END LOOP;
END
$$;

-- ============================================================
-- pvs_sync_status — joined-scope policy via pvs_link.
-- ============================================================
ALTER TABLE pvs_sync_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE pvs_sync_status FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pvs_sync_status_tenant ON pvs_sync_status;
CREATE POLICY pvs_sync_status_tenant ON pvs_sync_status
  USING (EXISTS (
    SELECT 1 FROM pvs_link l
    WHERE l.id = pvs_sync_status.pvs_link_id
      AND l.clinic_id = app_current_clinic()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM pvs_link l
    WHERE l.id = pvs_sync_status.pvs_link_id
      AND l.clinic_id = app_current_clinic()
  ));
