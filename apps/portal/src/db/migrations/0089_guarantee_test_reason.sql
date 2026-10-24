-- 0089_guarantee_test_reason.sql
-- Portal review K-3 (FX-G): a test entry on the EINS Zielseite (onboarding,
-- "Test der EINS-Seite, keine echte Person") can be rejected as a guarantee
-- candidate with its own reason instead of "Spam oder automatisierte Eingabe".
-- Rejections with this reason also drop out of the Rückruf-Lage (Folge 3).
--
-- Widens the CHECK only (every existing value stays allowed). Idempotent:
-- drop and re-add under the same name.

ALTER TABLE guarantee_candidate_rejections
  DROP CONSTRAINT IF EXISTS guarantee_rejections_reason_check;

ALTER TABLE guarantee_candidate_rejections
  ADD CONSTRAINT guarantee_rejections_reason_check CHECK (reason IN (
    'spam_automatisiert',
    'dieselbe_person_30_tage',
    'bewerbung',
    'verkaufsangebot',
    'keine_kontaktdaten',
    'test_eintrag'
  ));
