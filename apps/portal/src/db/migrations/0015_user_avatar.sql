-- User profile pictures.
--
-- Stored as a storage adapter URL (relative `/api/files/...` in dev, absolute
-- R2 URL in prod). Nullable — users without a picture render as initials in
-- the <Avatar> component. Capped at 500 chars to match the rest of the URL
-- columns in this schema.

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS avatar_url varchar(500);
