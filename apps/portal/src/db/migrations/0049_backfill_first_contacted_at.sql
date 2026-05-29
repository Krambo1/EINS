-- Backfill first_contacted_at for historical rows.
--
-- Hintergrund: bis einschließlich 0048 hat nichts im Portal-Code je
-- `requests.first_contacted_at` geschrieben (UI ist read-only, Bridge hat
-- die Spalte ignoriert). Die Spalte war für SLA-Off-Switch und Reaktions-
-- median gedacht, war aber überall NULL → KPI tot, SLA-Breach feuerte
-- effektiv für jede überfällige Anfrage.
--
-- Mit Option 1b (siehe pvs-status-derive.applyToRequest) wird der Stempel
-- ab jetzt beim ersten Bridge-Move neu → * gesetzt. Diese Migration zieht
-- den gleichen Stempel rückwirkend für Bestandsdaten nach:
--
--   * status NOT IN ('neu','spam')  und  first_contacted_at IS NULL
--     → first_contacted_at = MIN(request_activities.created_at)
--       für die status_change-Activities derselben request.
--     → fällt zurück auf requests.created_at, falls keine status_change-
--       Activity existiert (z.B. Seed/Bulk-Import direkt in
--       termin_vereinbart eingefügt).
--
-- Idempotent: läuft nur über Zeilen mit IS NULL, kann ohne Schaden
-- mehrfach ausgeführt werden.

SET statement_timeout = 0;
SET lock_timeout = 0;

WITH first_status_change AS (
  SELECT
    request_id,
    MIN(created_at) AS first_at
  FROM request_activities
  WHERE kind = 'status_change'
  GROUP BY request_id
)
UPDATE requests r
SET first_contacted_at = COALESCE(fsc.first_at, r.created_at)
FROM first_status_change fsc
WHERE r.id = fsc.request_id
  AND r.first_contacted_at IS NULL
  AND r.status NOT IN ('neu', 'spam');

-- Fallback für Rows ganz ohne status_change-Activity (kein JOIN-Match oben).
UPDATE requests
SET first_contacted_at = created_at
WHERE first_contacted_at IS NULL
  AND status NOT IN ('neu', 'spam');
