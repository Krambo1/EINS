-- Track the first time any clinic user opened a request's detail page.
--
-- Drives the sidebar Anfragen "unread" badge: the badge should clear only
-- when the user actually interacts with a lead (opens its detail page),
-- not merely when they land on the inbox list. We can't reuse
-- `first_contacted_at` for this — that one represents the SLA timer for
-- *outbound* contact and only flips when the user logs a call/email.
--
-- Set-once column: written exactly once, on first detail-page render,
-- inside the same RLS-scoped transaction that reads the request.

ALTER TABLE requests
  ADD COLUMN IF NOT EXISTS first_viewed_at timestamp with time zone;

-- Partial index for the badge count query
-- (`status = 'neu' AND first_viewed_at IS NULL`). Drops to a near-empty
-- index since the predicate matches very few rows in steady state.
CREATE INDEX IF NOT EXISTS requests_unread_idx
  ON requests (clinic_id)
  WHERE status = 'neu' AND first_viewed_at IS NULL;
