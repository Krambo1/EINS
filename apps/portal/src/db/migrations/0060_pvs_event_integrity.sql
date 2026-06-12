-- Pentest H3: admin "replay" re-applies a stored pvs_event_log payload through
-- the live ingest pipeline. The original per-clinic wire HMAC cannot be
-- re-verified at replay time (re-enrollment rotates that secret), so a row
-- tampered with at rest would replay as trusted.
--
-- Fix: at ingest we now write a SERVER-SIDE integrity tag over the canonical
-- payload, keyed by a key derived from SESSION_SECRET (HKDF context
-- 'pvs-event-integrity-v1') that lives only in app memory, never in the DB.
-- A DB-only attacker therefore cannot forge a matching tag. Replay recomputes
-- and compares before applying; a mismatch is refused.
--
-- pvs_event_log is RANGE-partitioned by occurred_at; ADD COLUMN on the parent
-- cascades to every partition. Existing rows get NULL and are treated as
-- "legacy" (replay allowed, audit-noted) so this migration is backward safe.
ALTER TABLE pvs_event_log
  ADD COLUMN IF NOT EXISTS payload_sig text;

COMMENT ON COLUMN pvs_event_log.payload_sig IS
  'Server-side HMAC-SHA256 over canonicalJson(payload), keyed by deriveSigningKey("pvs-event-integrity-v1"). Written at ingest, re-verified before admin replay to detect at-rest tampering. NULL = ingested before this column (legacy, replay allowed with audit note).';
