-- 0104_retreatment_calls.sql
-- Wiederbehandlungen are called from the call cards of /anfragen (Karam,
-- 2026-10-29), next to the new Anfragen. The result of such a call is kept
-- on the cycle, not as a call on the old Anfrage: a call activity there
-- would count as that Anfrage's first contact attempt (response-time.ts)
-- and change its Reaktionszeit long after the fact.
--
-- termin_vereinbart: the team made a date on the phone. The cycle leaves the
--   call cards until the PVS reports the date (the nightly rebuild then sets
--   status 'booked'), or comes back after 21 days if it never does.
-- nicht_erreicht: stays in the call cards, behind everyone not yet called.
--
-- The rebuild (retreatment-refresh.ts) upserts a fixed column list, so it
-- never touches these columns.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE retreatment_cycles
  ADD COLUMN IF NOT EXISTS last_call_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_call_outcome text;

ALTER TABLE retreatment_cycles DROP CONSTRAINT IF EXISTS retreatment_cycles_last_call_outcome_check;
ALTER TABLE retreatment_cycles ADD CONSTRAINT retreatment_cycles_last_call_outcome_check
  CHECK (last_call_outcome IS NULL OR last_call_outcome IN ('termin_vereinbart','nicht_erreicht'));
