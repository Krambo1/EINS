-- Switch avatar storage from "full URL persisted in DB" to "storage key only".
--
-- Rationale: 0015 persisted the resolved URL (e.g. `https://cdn.eins.de/...`),
-- which couples the DB to a specific CDN/bucket domain. Moving to a different
-- bucket — or flipping from public-read to signed URLs — would require a bulk
-- UPDATE to rewrite every row. Storing only the storage key (e.g.
-- `avatars/<userId>.webp`) and resolving it through the Storage adapter at
-- render time keeps the persistence layer driver-agnostic.
--
-- `avatar_updated_at` powers a per-user cache-buster: the resolved URL gets
-- `?v=<unix-ms>` appended so browsers re-fetch immediately after an upload.

-- 0015 was applied with the old design but no avatars uploaded yet — wipe
-- any leftover URL strings so the renamed column only ever contains keys.
UPDATE clinic_users SET avatar_url = NULL;

ALTER TABLE clinic_users
  RENAME COLUMN avatar_url TO avatar_key;

ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS avatar_updated_at timestamp with time zone;
