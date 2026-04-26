-- Compound index on request_activities(request_id, created_at).
--
-- The /anfragen list page filters with `staleOnly=1`, which translates to
-- the correlated subquery
--     (SELECT max(created_at)
--      FROM request_activities
--      WHERE request_id = requests.id) < now() - interval '14 days'
-- For a clinic with thousands of requests this scans the heap of every
-- activity row per matched request. The composite index lets Postgres get
-- MAX(created_at) per request from the index leaf in O(log n).
--
-- CREATE INDEX CONCURRENTLY so the migration doesn't take an ACCESS
-- EXCLUSIVE lock; safe to run on a live clinic table.

CREATE INDEX CONCURRENTLY IF NOT EXISTS request_activities_request_created_idx
  ON request_activities (request_id, created_at);
