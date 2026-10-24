-- 0094_email_claim_delivered.sql
-- Claim and delivery are separate (portal review V4 Neben 2).
--
-- email_send_log.sent_at and requests.new_request_notified_at are CLAIM
-- times: they are set before the mail goes out. If the function dies between
-- claim and send (timeout, deploy), the claim used to stay forever and the
-- mail never left. Now:
--   * delivered_at / new_request_delivered_at is set only after the provider
--     accepted the mail;
--   * a claim older than 15 minutes without delivery may be taken again
--     (server/email-once.ts, server/request-notify.ts, /api/cron/morning).
-- The retry reuses the same Resend Idempotency-Key, so a retry after an
-- unknown outcome cannot double-send within Resend's 24 h window.
--
-- Rows that exist before this migration are old news: they are marked as
-- delivered so nothing historic is ever re-sent. The backfill runs only in
-- the same transaction that adds the column, so a re-run changes nothing.
--
-- No Drizzle mirror: both columns are touched only through raw SQL.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'email_send_log' AND column_name = 'delivered_at'
  ) THEN
    ALTER TABLE email_send_log ADD COLUMN delivered_at timestamptz;
    UPDATE email_send_log SET delivered_at = sent_at;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'requests' AND column_name = 'new_request_delivered_at'
  ) THEN
    ALTER TABLE requests ADD COLUMN new_request_delivered_at timestamptz;
    UPDATE requests
       SET new_request_delivered_at = new_request_notified_at
     WHERE new_request_notified_at IS NOT NULL;
  END IF;
END
$$;
