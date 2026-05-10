-- Remove the packages/plan system. EINS no longer has tiered packages —
-- every clinic gets the full feature set, so the upgrade workflow and the
-- plan column on clinics are obsolete.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- Drop the upgrade_requests table (RLS policy goes with it).
DROP POLICY IF EXISTS upgrade_requests_tenant ON upgrade_requests;
DROP TABLE IF EXISTS upgrade_requests;

-- Drop the plan column + check constraint on clinics, plus its start-of-cycle
-- timestamp which only existed to mark plan transitions.
ALTER TABLE clinics DROP CONSTRAINT IF EXISTS clinics_plan_check;
ALTER TABLE clinics DROP COLUMN IF EXISTS plan;
ALTER TABLE clinics DROP COLUMN IF EXISTS plan_started_at;
