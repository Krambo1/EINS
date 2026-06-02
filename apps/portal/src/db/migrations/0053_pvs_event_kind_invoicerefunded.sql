-- 0053_pvs_event_kind_invoicerefunded.sql
--
-- WS0 hotfix: make InvoiceRefunded ingestable.
--
-- The canonical event contract (server/pvs-events.ts Zod union) and the
-- status-derive worker (worker/processors/pvs-status-derive.ts) both ship
-- InvoiceRefunded support, but the pvs_event_log.kind CHECK created in 0022
-- never listed it. Every InvoiceRefunded insert therefore violated the CHECK
-- (SQLSTATE 23514), which applyPvsEvent surfaced as internal_error -> HTTP 500,
-- and the agent retried forever (a 500 is retryable). Net effect: refunds
-- could never land and the dashboard never netted revenue back down. This
-- widens the CHECK to the full 9-kind canonical set.
--
-- Additive widening only: no existing row can violate a CHECK that merely adds
-- an allowed value, so we ADD the constraint NOT VALID to skip the validation
-- pass over existing rows. pvs_event_log is RANGE-partitioned and projected to
-- ~30M rows in year 1; a validating ADD would hold a long lock while it scans
-- every partition. NOT VALID still enforces the CHECK on all new inserts (it
-- only skips re-checking pre-existing rows), so no later VALIDATE is needed.
--
-- Partitioned table: re-issue the CHECK on the PARENT only. Postgres 12+
-- cascades a parent CHECK to all existing and future partitions. Never
-- hand-alter the pvs_event_log_YYYY_MM child tables.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE pvs_event_log
  DROP CONSTRAINT IF EXISTS pvs_event_log_kind_check;

ALTER TABLE pvs_event_log
  ADD CONSTRAINT pvs_event_log_kind_check CHECK (
    kind IN (
      'PatientUpserted',
      'AppointmentCreated',
      'AppointmentStatusChanged',
      'AppointmentCancelled',
      'EncounterCompleted',
      'InvoicePaid',
      'InvoiceRefunded',
      'RecallScheduled',
      'PatientMerged'
    )
  ) NOT VALID;
