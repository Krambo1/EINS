-- Drop the per-user Einfach/Detail UI mode. The toggle has been removed from
-- the portal; Detail is now the only mode, so the column and its check
-- constraint are dead weight.

ALTER TABLE clinic_users
  DROP CONSTRAINT IF EXISTS clinic_users_ui_mode_check;

ALTER TABLE clinic_users
  DROP COLUMN IF EXISTS ui_mode;
