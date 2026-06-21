-- 0064_onboarding_tour.sql
-- Per-user lifecycle flags for the interactive portal product-tour.
--
-- Two nullable timestamps on clinic_users, both NULL by default:
--
--   onboarding_tour_completed_at  -- set when the user reaches the end of the
--                                    guided tour ("Fertig").
--   onboarding_tour_dismissed_at  -- set when the user resolves the one-time
--                                    "Rundgang starten?" prompt without
--                                    completing it (clicks "Später", or starts
--                                    the tour from the prompt). "Auto-prompt has
--                                    been dispatched" — not a failure state.
--
-- The gentle first-login auto-prompt fires only for role = 'inhaber' when BOTH
-- columns are NULL. Once either is set, the prompt never auto-launches again.
-- The tour stays re-launchable on demand from Einstellungen regardless of these
-- flags (manual start does not depend on or clear them).
--
-- Existing users get NULL → the tour is offered to them once on their next
-- login. That is intended: this is a new feature surfaced once per user.
--
-- Read path: these columns are selected in getSession() on the superuser
-- connection (auth infrastructure), same as role. Write path: the
-- complete/dismiss server actions update via the superuser `db`, scoped by
-- clinic_users.id = session.userId, mirroring updateOwnProfileAction. They are
-- never touched by the eins_app role, so no RLS policy or column GRANT changes
-- are needed (table-level grants already cover added columns).

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS onboarding_tour_completed_at timestamptz;

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS onboarding_tour_dismissed_at timestamptz;
