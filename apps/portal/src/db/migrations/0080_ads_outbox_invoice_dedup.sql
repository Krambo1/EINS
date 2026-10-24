-- 0080_ads_outbox_invoice_dedup.sql
-- One ad-platform Purchase per PVS invoice, not per pvs_event_log row.
--
-- The old guard was UNIQUE(clinic_id, channel, pvs_event_log_id). A re-emitted
-- invoice (corrected re-export, FHIR redelivery) or an admin replay lands as a
-- NEW pvs_event_log row with a new id, so the same payment produced a second
-- Meta / Google Purchase. These columns carry the invoice identity so the
-- outbox can dedup on it. Nullable: rows written before this migration (and
-- invoices without a pvsInvoiceId) keep the per-event guard only. No backfill.

ALTER TABLE ads_conversion_outbox
  ADD COLUMN IF NOT EXISTS bridge_source  text,
  ADD COLUMN IF NOT EXISTS pvs_invoice_id text;

CREATE UNIQUE INDEX IF NOT EXISTS ads_conversion_outbox_invoice_unique
  ON ads_conversion_outbox (clinic_id, channel, bridge_source, pvs_invoice_id)
  WHERE pvs_invoice_id IS NOT NULL;
