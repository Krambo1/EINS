-- Phase 3 (Bucket B): admit the cloud REST adapters Pabau + Consentz
-- into the PVS vendor + bridge source enums.
--
-- Why a check-constraint migration: pvs_link.pvs_vendor and
-- pvs_event_log.bridge_source are guarded by text CHECK constraints, not
-- Postgres ENUM types. We re-issue the constraints with the extended
-- value lists.
--
-- The brief's "do not change the canonical event schema" rule applies
-- to event kinds (PatientUpserted, AppointmentCreated, …), which stay
-- identical here. Adding a bridge_source is a coordinated bridge/portal
-- migration: the same kinds, new producers.

SET statement_timeout = 0;
SET lock_timeout = 0;

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
      'none'
    )
  );

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
      'n8n_custom'
    )
  );
