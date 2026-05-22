-- /api/leads/intake — idempotency-key support.
--
-- Background: Round 2 testing observed parallel duplicate POSTs (same body,
-- same signature) both creating distinct request rows. Clients submitting
-- the same form on flaky networks would double-submit, doubling lead-count
-- KPIs.
--
-- Wire contract: callers send an `Idempotency-Key: <opaque>` header. The
-- value is up to 200 chars of arbitrary characters; we store it verbatim
-- and dedupe on (clinic_id, key). A second POST with the same key returns
-- the originally created request id. Keys are clinic-scoped (so two
-- different Praxen using the same UUID collision-free).
--
-- Implementation:
--   • `intake_idempotency_key` column on requests
--   • Partial unique index lets non-keyed rows coexist
--   • persistLead does ON CONFLICT DO NOTHING and looks up the survivor
--
-- Schema cost: one nullable text column + one partial b-tree index. No
-- migration of existing rows needed.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS intake_idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS requests_intake_idempotency_unique
  ON requests(clinic_id, intake_idempotency_key)
  WHERE intake_idempotency_key IS NOT NULL;
