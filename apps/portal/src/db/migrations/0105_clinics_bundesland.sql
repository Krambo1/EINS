-- 0105_clinics_bundesland.sql
-- Land of the Praxis (Vertrag 01 Ziffer 1.7: only the statutory holidays at
-- the seat of the Praxis count for the 48 Werkstunden). ISO 3166-2:DE code
-- without the "DE-" prefix (lib/bundesland.ts). Set in the admin Stammdaten.
-- NULL = not stored yet: lib/werkstunden.ts then skips the union of the
-- holidays of all 16 Länder, as before this migration. No backfill: the
-- portal holds no reliable address to derive it from.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinics ADD COLUMN IF NOT EXISTS bundesland text;

ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_bundesland_check;
ALTER TABLE clinics
  ADD CONSTRAINT clinics_bundesland_check
  CHECK (bundesland IS NULL OR bundesland IN (
    'BW', 'BY', 'BE', 'BB', 'HB', 'HH', 'HE', 'MV',
    'NI', 'NW', 'RP', 'SL', 'SN', 'ST', 'SH', 'TH'
  ));
