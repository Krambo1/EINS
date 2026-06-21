-- 0065_onboarding_flow.sql
-- Onboarding-flow wiring on top of the Discovery-Fragebogen (0061),
-- Asset-Checkliste (0062) and the interactive tour (0064).
--
-- Two unrelated nullable timestamps, both NULL by default:
--
--   clinic_users.onboarding_tour_nav_card_dismissed_at
--     Set when the user clicks the X on the small "Portal-Rundgang" card that
--     appears in the left nav after the first-login tour prompt was skipped or
--     the tour was abandoned. Once set, that nav card never re-appears; the
--     tour stays re-launchable from Einstellungen. Read in getSession() on the
--     superuser connection (auth infrastructure), written by the
--     dismiss-nav-card server action via the superuser `db`, scoped by
--     clinic_users.id = session.userId (mirrors the other two tour flags). The
--     eins_app role never touches it, so no RLS / column GRANT change is needed
--     (table-level grants already cover added columns).
--
--   discovery_fragebogen.resubmitted_at
--     Set when the Praxis re-submits the questionnaire AFTER its first
--     submission (the owner may now reopen + edit answers from Einstellungen).
--     Drives the "Erneut eingereicht am ..." badge on the admin clinic
--     Fragebogen tab so EINS notices that a baseline changed. submitted_at
--     keeps the FIRST submission time; resubmitted_at holds the latest re-send.
--     Written through withClinicContext (eins_app role); the existing
--     table-level GRANT covers the added column, RLS policy is unchanged.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS onboarding_tour_nav_card_dismissed_at timestamptz;

ALTER TABLE discovery_fragebogen
  ADD COLUMN IF NOT EXISTS resubmitted_at timestamptz;
