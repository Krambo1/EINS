-- Add 'total_requests' as a settable goal metric so the "Anfragen gesamt"
-- dashboard tile can render a progress bar like the qualified-leads and
-- revenue tiles do.

ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_metric_check;
ALTER TABLE goals ADD CONSTRAINT goals_metric_check
  CHECK (metric IN ('qualified_leads','revenue','cases_won','appointments','spend','total_requests'));
