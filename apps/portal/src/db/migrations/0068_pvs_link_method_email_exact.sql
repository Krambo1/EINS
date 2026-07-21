-- 0068: allow link_method 'email_exact' on pvs_patient_map.
--
-- Code/schema drift found by the soak harness (48h run, 2026-07-20): the
-- linking resolver in src/server/pvs-linking.ts writes FIVE link methods
--
--   external_id, bemerkung_token, email_exact, fuzzy, manual
--
-- but the check constraint from 0023 only ever listed four. 'email_exact'
-- was added to the resolver without extending the constraint, so every
-- patient that links by exact e-mail match fails the INSERT with 23514.
--
-- Blast radius before this fix: the revenue row itself survives (the
-- event_log row is committed BEFORE linking runs, see pvs-events.ts), so
-- cent-exact reconciliation still passed and no money was lost. What broke
-- is the patient LINK: the ingest call returns 500, the agent retries the
-- event forever against a constraint that can never accept it, and the
-- patient's lifetime_revenue_eur / dashboard attribution silently omit
-- those payments. A Praxis whose PVS exports e-mail addresses but no
-- stable external ID hits this on nearly every payment.
--
-- Purely additive: widening a CHECK cannot invalidate existing rows.

ALTER TABLE pvs_patient_map
  DROP CONSTRAINT IF EXISTS pvs_patient_map_method_check;

ALTER TABLE pvs_patient_map
  ADD CONSTRAINT pvs_patient_map_method_check CHECK (
    link_method IN ('external_id','bemerkung_token','email_exact','fuzzy','manual')
  );
