-- Drop the "qualifiziert" pipeline stage and rename the qualified-leads KPI.
--
-- Karam's call: jeder Lead, der im Portal landet, ist per Definition
-- qualifiziert (Vorqualifizierung passiert upstream am Landingpage-Formular
-- und im Outreach). Eine eigene "qualifiziert"-Stage zwischen "neu" und
-- "termin_vereinbart" ist deshalb Theater — der MFA-Anruf führt entweder
-- direkt zum Termin oder zu nichts. Stages werden zu:
--
--   neu → termin_vereinbart → beratung_erschienen → behandelt → gewonnen
--                                                            → no_show
--                                                            → verloren
--   / spam
--
-- Daten-Migration:
--   * requests.status='qualifiziert' wird auf 'neu' zurückgesetzt (die
--     Anfragen haben noch keinen Termin, sie gehören in die offene Queue).
--   * kpi_daily.qualified_leads → leads (Spalten-Rename; historische Zahlen
--     bleiben byte-identisch erhalten).
--   * kpi_daily.cost_per_qualified_lead → cost_per_lead (gleicher Grund).
--   * goals.metric='qualified_leads' → 'leads', CHECK passt nach.
--
-- Reversibel im Notfall:
--   * Stage-Backfill nicht (wir verlieren die ursprüngliche Information,
--     dass das Lead "qualifiziert" war — aber die Information war ohnehin
--     bedeutungslos, siehe Begründung oben).
--   * Spalten-Renames per RENAME zurück. Historische kpi_daily-Werte werden
--     dabei nicht angefasst.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- 1. requests.status: bestehende qualifizierte Anfragen zurück nach 'neu',
--    dann CHECK ohne 'qualifiziert' neu setzen.
UPDATE requests SET status = 'neu' WHERE status = 'qualifiziert';

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_status_check;
ALTER TABLE requests ADD CONSTRAINT requests_status_check CHECK (
  status IN (
    'neu',
    'termin_vereinbart',
    'beratung_erschienen',
    'no_show',
    'behandelt',
    'gewonnen',
    'verloren',
    'spam'
  )
);

-- 2. kpi_daily: Spalten umbenennen. Datenbestand bleibt 1:1 erhalten,
--    historische "qualifizierte Anfragen" = "Anfragen (ohne Spam)" gilt
--    per Definition weiter.
ALTER TABLE kpi_daily RENAME COLUMN qualified_leads        TO leads;
ALTER TABLE kpi_daily RENAME COLUMN cost_per_qualified_lead TO cost_per_lead;

-- 3. goals.metric: alte Zielwerte für 'qualified_leads' weiterführen unter
--    dem neuen Namen 'leads', CHECK angepasst.
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_metric_check;
UPDATE goals SET metric = 'leads' WHERE metric = 'qualified_leads';
ALTER TABLE goals ADD CONSTRAINT goals_metric_check CHECK (
  metric IN ('leads','revenue','cases_won','appointments','spend','total_requests')
);
