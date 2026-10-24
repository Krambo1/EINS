-- 0093: upload diagnostics from the on-prem agent heartbeat (WP-C B5).
-- Additive and nullable: older agents never write it.
ALTER TABLE pvs_agent_status ADD COLUMN IF NOT EXISTS upload_diagnostics jsonb;
