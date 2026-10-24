-- 0087_request_notified.sql
-- "Neue Anfrage" email to the Praxis (WS1, findings C-5 / E-05 / H-05).
--
-- new_request_notified_at is claimed atomically right before the email is
-- sent (UPDATE ... WHERE new_request_notified_at IS NULL RETURNING), so every
-- request is announced exactly once, even when Meta retries a webhook or two
-- instances race. NULL = not announced yet.
--
-- Existing rows are backfilled with created_at: they are old news, and a
-- later catch-up sweep must never mail the whole history.
--
-- No Drizzle mirror: only server/request-notify.ts touches it, via raw SQL.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS new_request_notified_at timestamptz;

UPDATE requests
   SET new_request_notified_at = created_at
 WHERE new_request_notified_at IS NULL;
