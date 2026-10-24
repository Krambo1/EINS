-- 0083_email_send_log.sql
-- Exactly-once ledger for automated emails (WS4, portal review E-08/E-19/E-26/G-11).
--
-- The daily Vercel cron (/api/cron/*) and the optional Fly worker can both run
-- the same processors. Every automated mail (monthly report, review request,
-- animation-ready, feedback alarm) first claims a stable key here with
-- INSERT ... ON CONFLICT DO NOTHING; only the claimer sends. A failed send
-- deletes its claim so the next run retries. The same key is passed to Resend
-- as Idempotency-Key, which also covers a crash between send and bookkeeping.
--
-- No Drizzle mirror: touched only through raw SQL in server/email-once.ts.

CREATE TABLE IF NOT EXISTS email_send_log (
  idempotency_key text PRIMARY KEY,
  clinic_id       uuid,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_send_log_sent_at_idx ON email_send_log (sent_at);

-- Platform plumbing, written only by the superuser connection.
REVOKE ALL ON email_send_log FROM eins_app;
