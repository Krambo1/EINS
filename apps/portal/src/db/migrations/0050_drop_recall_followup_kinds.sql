-- Recall feature removal — drop the MFA-facing recall workflow entirely.
--
-- Scope:
--   1. `request_recalls.kind` is narrowed to a single legal value
--      ('review_request'). Existing 'recall' and 'followup' rows are
--      deleted.
--   2. `treatments.default_recall_months` is dropped. The column was
--      collected via the Einstellungen form ("Folgetermin (Monate)") but
--      consumed by nothing — pure dead config.
--
-- Hintergrund:
--   * `request_recalls` historically held three flavours:
--       - kind='review_request'  → Bewertungsanfrage-Email-Scheduler
--                                  (review-request worker, /stimme stats,
--                                   review-token endpoints). KEEPS.
--       - kind='recall'          → placeholder for a PVS-Wiederbestellung
--                                  mirror that was never wired up. No
--                                  code path creates these. DEAD.
--       - kind='followup'        → manual MFA-Nachfass-Liste, surfaced
--                                  only by the dashboard "Offene Leads"
--                                  card (removed) and seeded from demo
--                                  data. DEAD.
--   * Recalls / Wiedervorlage belong in the PVS (Charly, Tomedo, Dampsoft,
--     Z1, …). The portal explicitly does not own that workflow — see
--     anfragen/[id]/actions.ts. Keeping dead enum values + dead config
--     invited future drift; this migration tightens the contract.
--
-- Effect on production data:
--   * 'recall' / 'followup' rows are deleted. No FK references survive —
--     the only incoming reference is `reviews.recall_id`, scoped to
--     'review_request' rows from day one.
--   * `treatments.default_recall_months` values are dropped with the
--     column. Any owner who set "Folgetermin (Monate)" loses that number;
--     it was never used by any workflow, so no behaviour changes.
--
-- Idempotent: re-running deletes nothing the second time, replaces the
-- check constraint in place, and `DROP COLUMN IF EXISTS` no-ops.

BEGIN;

DELETE FROM request_recalls
WHERE kind IN ('recall', 'followup');

ALTER TABLE request_recalls
  DROP CONSTRAINT IF EXISTS request_recalls_kind_check;

ALTER TABLE request_recalls
  ADD CONSTRAINT request_recalls_kind_check
  CHECK (kind = 'review_request');

ALTER TABLE treatments
  DROP COLUMN IF EXISTS default_recall_months;

COMMIT;
