-- 0092_clinic_notice_stoerung.sql
-- Portal review K-7 Teil 2 (INT-C): the admin can send the e-mail notice for
-- a Plattform-Störung from the portal, stored in clinic_notices like a
-- Verzug notice. Widens the kind CHECK by 'stoerung' (every existing value
-- stays allowed). Idempotent: drop and re-add under the same name.
-- (0090 and 0091 were already taken when this was written.)

ALTER TABLE clinic_notices
  DROP CONSTRAINT IF EXISTS clinic_notices_kind_check;

ALTER TABLE clinic_notices
  ADD CONSTRAINT clinic_notices_kind_check
    CHECK (kind IN ('verzug', 'warnung_rueckruf', 'pause', 'fortsetzung', 'fristende', 'stoerung'));
