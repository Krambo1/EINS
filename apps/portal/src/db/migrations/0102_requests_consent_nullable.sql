-- 0102_requests_consent_nullable.sql
-- Organic-first portal, phase 6: calls on the tracking number, bookings over
-- the booking link and front-desk entries carry no form consent. Until now
-- dsgvo_consent_at was NOT NULL and got the arrival time, which recorded a
-- consent nobody gave. From now on those rows store NULL (server/leads.ts);
-- the legal basis for them is the inquiry itself (Art. 6 Abs. 1 lit. b DSGVO).
-- Existing rows stay untouched: an older manual entry may stand for a
-- consent collected elsewhere, and clearing it would lose that record.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE requests ALTER COLUMN dsgvo_consent_at DROP NOT NULL;

