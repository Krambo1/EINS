-- Support schema. Source of truth: D:/Desktop/Claude/eins-support/src/schema.sql (applied by its migrate script); kept identical here. Idempotent.
CREATE SCHEMA IF NOT EXISTS support;
CREATE TABLE IF NOT EXISTS support.clients (
 clinic_id uuid PRIMARY KEY, practice_name text NOT NULL, emails text[] NOT NULL,
 active boolean NOT NULL DEFAULT false, test_only boolean NOT NULL DEFAULT true,
 contract_text text NOT NULL, contract_ref text NOT NULL, contract_hash text NOT NULL,
 contract_accepted_at timestamptz NOT NULL, privacy_ref text NOT NULL,
 ai_allowed boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS support.cases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), clinic_id uuid NOT NULL REFERENCES support.clients(clinic_id),
 channel text NOT NULL CHECK(channel IN ('email','portal')), subject text NOT NULL, recipient text NOT NULL,
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RESOLVED')),
 mode text NOT NULL DEFAULT 'auto' CHECK(mode IN ('auto','manual')),
 revision integer NOT NULL DEFAULT 0, needs_action boolean NOT NULL DEFAULT false,
 waiting_for text NOT NULL DEFAULT 'none', action text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '',
 received_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 first_response_at timestamptz, closed_at timestamptz, UNIQUE(id,clinic_id)
);
CREATE TABLE IF NOT EXISTS support.messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid NOT NULL, clinic_id uuid NOT NULL,
 direction text NOT NULL CHECK(direction IN ('inbound','automatic','manual')),
 external_id text NOT NULL UNIQUE, sender text NOT NULL, body text NOT NULL,
 received_at timestamptz NOT NULL, stored_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz, first_response_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}',
 FOREIGN KEY(case_id,clinic_id) REFERENCES support.cases(id,clinic_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_messages_pending ON support.messages(received_at) WHERE processed_at IS NULL AND direction='inbound';
CREATE TABLE IF NOT EXISTS support.outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), case_id uuid REFERENCES support.cases(id) ON DELETE CASCADE,
 trigger_id uuid REFERENCES support.messages(id) ON DELETE CASCADE, kind text NOT NULL CHECK(kind IN ('reply','report','alert','manual')),
 dedupe_key text NOT NULL UNIQUE, payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','delivered','failed','uncertain','cancelled')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 first_attempt_at timestamptz, accepted_at timestamptz, delivered_at timestamptz, provider_id text,
 error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_outbox_due ON support.outbox(next_attempt_at) WHERE state IN ('pending','sending');
ALTER TABLE support.outbox ADD COLUMN IF NOT EXISTS last_delivery_check_at timestamptz;
ALTER TABLE support.outbox ADD COLUMN IF NOT EXISTS sent_copy_at timestamptz;
CREATE TABLE IF NOT EXISTS support.events (id bigserial PRIMARY KEY,kind text NOT NULL,case_id uuid REFERENCES support.cases(id) ON DELETE CASCADE,detail jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS support.health(component text PRIMARY KEY,ok boolean NOT NULL,detail text NOT NULL DEFAULT '',checked_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS support.cursors(folder text PRIMARY KEY,validity text NOT NULL,last_uid bigint NOT NULL);
CREATE TABLE IF NOT EXISTS support.disclosures(clinic_id uuid NOT NULL REFERENCES support.clients(clinic_id),recipient text NOT NULL,channel text NOT NULL,disclosed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(clinic_id,recipient,channel));
CREATE TABLE IF NOT EXISTS support.knowledge (
 id text PRIMARY KEY, path text NOT NULL, title text NOT NULL, body text NOT NULL, hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('business','contract')), status text NOT NULL CHECK(status IN ('current','historical','draft','conflicted')),
 audience text NOT NULL CHECK(audience IN ('client','internal')), precedence integer NOT NULL,
 clinic_id uuid REFERENCES support.clients(clinic_id), snapshot_id uuid NOT NULL,
 search tsvector GENERATED ALWAYS AS (to_tsvector('german', title || ' ' || body)) STORED
);
CREATE INDEX IF NOT EXISTS support_knowledge_search ON support.knowledge USING gin(search);
CREATE TABLE IF NOT EXISTS support.snapshots(id uuid PRIMARY KEY,completed_at timestamptz NOT NULL,source_count integer NOT NULL,manifest_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS support.settings(key text PRIMARY KEY,value jsonb NOT NULL);
-- Control client: synthetic end-to-end probe through the real mail path, answered without AI and without reports.
ALTER TABLE support.clients ADD COLUMN IF NOT EXISTS canary boolean NOT NULL DEFAULT false;
ALTER TABLE support.clients ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE support.outbox DROP CONSTRAINT IF EXISTS outbox_kind_check;
ALTER TABLE support.outbox ADD CONSTRAINT outbox_kind_check CHECK(kind IN ('reply','report','alert','manual','ack','probe'));
-- Messages from addresses no practice has registered. Never answered by AI; a fixed holding reply only for a matching practice domain.
CREATE TABLE IF NOT EXISTS support.unassigned(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_id text NOT NULL UNIQUE, sender text NOT NULL, subject text NOT NULL, body text NOT NULL,
 received_at timestamptz NOT NULL, stored_at timestamptz NOT NULL DEFAULT now(), authenticated boolean NOT NULL,
 probable_clinic_id uuid REFERENCES support.clients(clinic_id) ON DELETE SET NULL, acknowledged_at timestamptz,
 resolution text, resolved_at timestamptz, metadata jsonb NOT NULL DEFAULT '{}'
);
-- One phone alarm per condition and 15-minute window, durable across restarts and machines.
CREATE TABLE IF NOT EXISTS support.pages(key text NOT NULL,time_window bigint NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(key,time_window));
REVOKE ALL ON SCHEMA support FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA support FROM PUBLIC;
ALTER TABLE support.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE support.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_client_tenant ON support.clients;
CREATE POLICY support_client_tenant ON support.clients FOR SELECT USING(clinic_id=nullif(current_setting('app.current_clinic_id',true),'')::uuid);
DROP POLICY IF EXISTS support_case_tenant ON support.cases;
CREATE POLICY support_case_tenant ON support.cases USING(clinic_id=nullif(current_setting('app.current_clinic_id',true),'')::uuid AND channel='portal');
DROP POLICY IF EXISTS support_message_read ON support.messages;
CREATE POLICY support_message_read ON support.messages FOR SELECT USING(clinic_id=nullif(current_setting('app.current_clinic_id',true),'')::uuid AND EXISTS(SELECT 1 FROM support.cases c WHERE c.id=case_id AND c.channel='portal'));
DROP POLICY IF EXISTS support_message_insert ON support.messages;
CREATE POLICY support_message_insert ON support.messages FOR INSERT WITH CHECK(clinic_id=nullif(current_setting('app.current_clinic_id',true),'')::uuid AND direction='inbound' AND EXISTS(SELECT 1 FROM support.cases c WHERE c.id=case_id AND c.channel='portal'));
DROP POLICY IF EXISTS support_message_update ON support.messages;
CREATE POLICY support_message_update ON support.messages FOR UPDATE USING(clinic_id=nullif(current_setting('app.current_clinic_id',true),'')::uuid AND direction='inbound');
DROP POLICY IF EXISTS support_event_insert ON support.events;
CREATE POLICY support_event_insert ON support.events FOR INSERT WITH CHECK(EXISTS(SELECT 1 FROM support.cases c WHERE c.id=case_id AND c.channel='portal'));
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='eins_app') THEN
  GRANT USAGE ON SCHEMA support TO eins_app;
  GRANT SELECT ON support.clients TO eins_app;
  GRANT SELECT,INSERT,UPDATE ON support.cases,support.messages TO eins_app;
  GRANT INSERT ON support.events TO eins_app;
  GRANT USAGE ON ALL SEQUENCES IN SCHEMA support TO eins_app;
  GRANT SELECT,INSERT,UPDATE ON support.health TO eins_app;
 END IF;
END $$;
