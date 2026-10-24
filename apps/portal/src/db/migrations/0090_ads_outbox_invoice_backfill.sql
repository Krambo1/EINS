-- 0090_ads_outbox_invoice_backfill.sql
-- Pass 2 (PVS bridge review): backfill the invoice identity that 0080 added.
--
-- 0080 made the ads outbox dedup per (clinic, channel, bridge_source,
-- pvs_invoice_id), but rows written before it kept both columns NULL. Those
-- legacy rows are invisible to the per-invoice unique index, so the first
-- re-emission or replay of an already-reported invoice after the deploy (a new
-- pvs_event_log row, new id) passed both guards and sent a SECOND Purchase to
-- Meta / Google for the same payment.
--
-- For each legacy Purchase row whose event is an InvoicePaid with an invoice
-- id, copy bridge_source + pvsInvoiceId from the event. Only the EARLIEST row
-- per (clinic, channel, source, invoice) is stamped, and only where no row
-- already carries that identity: a pre-0080 duplicate that was already sent
-- stays NULL (stamping it would violate the unique index). Idempotent: a
-- re-run only looks at rows that are still NULL.

WITH legacy AS (
  SELECT
    o.id,
    o.clinic_id,
    o.channel,
    o.created_at,
    e.bridge_source,
    e.payload->>'pvsInvoiceId' AS pvs_invoice_id
  FROM ads_conversion_outbox o
  JOIN pvs_event_log e
    ON e.id = o.pvs_event_log_id
   AND e.clinic_id = o.clinic_id
  WHERE o.pvs_invoice_id IS NULL
    AND o.event_name = 'Purchase'
    AND e.kind = 'InvoicePaid'
    AND COALESCE(e.payload->>'pvsInvoiceId', '') <> ''
),
ranked AS (
  SELECT
    l.*,
    row_number() OVER (
      PARTITION BY l.clinic_id, l.channel, l.bridge_source, l.pvs_invoice_id
      ORDER BY l.created_at, l.id
    ) AS rn
  FROM legacy l
  WHERE NOT EXISTS (
    SELECT 1
    FROM ads_conversion_outbox x
    WHERE x.clinic_id = l.clinic_id
      AND x.channel = l.channel
      AND x.bridge_source = l.bridge_source
      AND x.pvs_invoice_id = l.pvs_invoice_id
  )
)
UPDATE ads_conversion_outbox o
SET bridge_source = r.bridge_source,
    pvs_invoice_id = r.pvs_invoice_id
FROM ranked r
WHERE o.id = r.id
  AND r.rn = 1;
