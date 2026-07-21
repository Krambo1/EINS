-- 0067: M-D6 billing-authority — dual-ingest-path mutual exclusion.
--
-- A GDT/CSV file watcher and a vendor DB/cloud adapter running for the SAME
-- Praxis stamp different bridge_source values, so the event-log dedup index
-- (clinic_id, bridge_source, pvs_external_event_id, occurred_at) can never
-- collapse the two copies of one logical payment. Cross-source natural-key
-- dedup is not viable either: the GDT export's Rechnungs-Kennung and the
-- vendor DB's invoice key do not match (H4 scopes invoice dedup per source
-- for the same reason). Instead the portal enforces ONE authoritative ingest
-- path for the billing domain (InvoicePaid / InvoiceRefunded) per clinic:
--
--   * billing_enabled = whether a source may emit revenue-bearing events.
--   * Vendor DB/cloud sources win by default; the GDT Honorar fields are a
--     lossy export of the vendor's billing tables.
--   * csv_upload / n8n_custom stay exempt (operator-driven, applyPvsEvent
--     never gates them), their rows keep the default true.
--   * Appointment / patient / recall kinds are NOT gated — mixed setups
--     where the file watcher covers one data kind and the DB adapter
--     another are legitimate (see the agent boot warning for M-D6).
--
-- Enforcement lives in applyPvsEvent (apps/portal/src/server/pvs-events.ts):
-- on the first collision it flips the gdt_agent row to false, raises a
-- standing dashboard alert, and rejects with billing_conflict (403,
-- non-retryable). This backfill pre-resolves clinics that already have both
-- paths enrolled so they never double-count in the first place.

SET statement_timeout = 0;
SET lock_timeout = 0;

ALTER TABLE pvs_link_source
  ADD COLUMN IF NOT EXISTS billing_enabled boolean NOT NULL DEFAULT true;

-- 'conflict' = row created/flipped by the applyPvsEvent billing gate itself
-- (the gdt_agent row normally exists via enrollment, but the gate upserts
-- defensively).
ALTER TABLE pvs_link_source
  DROP CONSTRAINT IF EXISTS pvs_link_source_enrolled_via_check;
ALTER TABLE pvs_link_source
  ADD CONSTRAINT pvs_link_source_enrolled_via_check
  CHECK (enrolled_via IN ('enrollment','heartbeat','backfill','manual','conflict'));

-- Backfill: where a continuous vendor path coexists with the GDT watcher,
-- the vendor path is authoritative for billing. The vendor can be visible
-- either as an explicit pvs_link_source row or implicitly as the clinic's
-- pvs_link.pvs_vendor (cloud adapters pass the vendor fast path and may
-- never get a pvs_link_source row).
UPDATE pvs_link_source g
SET billing_enabled = false
WHERE g.bridge_source = 'gdt_agent'
  AND (
    EXISTS (
      SELECT 1 FROM pvs_link_source v
      WHERE v.clinic_id = g.clinic_id
        AND v.bridge_source NOT IN ('gdt_agent', 'csv_upload', 'n8n_custom')
    )
    OR EXISTS (
      SELECT 1 FROM pvs_link l
      WHERE l.clinic_id = g.clinic_id
        AND l.pvs_vendor NOT IN ('gdt_agent', 'csv_upload', 'n8n_custom', 'none')
    )
  );
