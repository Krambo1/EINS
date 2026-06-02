-- 0057_multi_currency.sql
-- Phase 11: thread the per-invoice currency (EUR/CHF) downstream so a Swiss
-- Praxis's revenue is attributed and displayed in CHF, not silently mislabelled
-- as EUR.
--
-- pvs_event_log.payload already carries `currency` (EUR default, CHF allowed
-- since the Finding-12 widening of the InvoicePaid/InvoiceRefunded Zod). What is
-- missing are the two persisted homes the derive worker, the ads workers, and
-- the UI read from:
--   * ads_conversion_outbox.currency: the currency sent to Meta CAPI / Google
--     OCI for that conversion, captured from the invoice event at enqueue time.
--   * clinics.currency: the Praxis billing currency, i.e. the display currency
--     for all of that clinic's revenue. lifetime_revenue_eur and
--     converted_revenue_eur hold numeric values in THIS currency; the _eur
--     suffix is now a legacy name, not an assertion that the value is EUR.
--
-- Both are small, non-partitioned tables, so a plain ADD COLUMN + CHECK is safe
-- (no NOT VALID / no partition cascade needed). Existing rows default to EUR,
-- which is correct: every clinic onboarded before Switzerland billed in EUR.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE ads_conversion_outbox
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

ALTER TABLE ads_conversion_outbox
  DROP CONSTRAINT IF EXISTS ads_conversion_outbox_currency_check;
ALTER TABLE ads_conversion_outbox
  ADD CONSTRAINT ads_conversion_outbox_currency_check
  CHECK (currency IN ('EUR', 'CHF'));

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'EUR';

ALTER TABLE clinics
  DROP CONSTRAINT IF EXISTS clinics_currency_check;
ALTER TABLE clinics
  ADD CONSTRAINT clinics_currency_check
  CHECK (currency IN ('EUR', 'CHF'));
