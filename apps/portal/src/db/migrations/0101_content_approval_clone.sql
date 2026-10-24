-- 0101_content_approval_clone.sql
-- Organic-first portal, phase 4: compliance gate fields, approval batches,
-- Verzug link into the Garantie-Uhr, clone records (PORTAL-ORGANISCH-BAUPLAN.md).
--
-- content_items             gate facts: HWG warnings acknowledged by name,
--                           "keine Vorher-Nachher ..." confirmed by name,
--                           stop_requested_* = "zu stoppen" after a clone
--                           revocation (open task until the post is stopped).
-- content_approval_batches  one weekly batch per Praxis: sent_at, due_at
--                           (2 Werktage, holidays of all 16 Länder, D9).
-- content_approvals         one row per post in a batch. decision NULL until
--                           the Praxis decides; the first decision wins
--                           (D7: e-mail link and portal button at the same
--                           time). token_hash = sha256 of the one-click link
--                           token, never the token itself.
-- guarantee_delays.approval_batch_id  the Verzug a late batch caused, unique
--                           so the job never creates it twice.
-- clone_records             KI-Klon of the Inhaber: consent, tool, training
--                           opt-out, model, revocation, contract end,
--                           deletion. Admin only.
--
-- Privileges: approvals are readable by the Praxis (its /beitraege page),
-- written only by EINS code (superuser handle). Batches likewise. Clone
-- records are admin only (RLS on, no policy, no grant), as 0076.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- Gate facts on posts ------------------------------------------------------
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS hwg_warnings_ack_by text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS hwg_warnings_ack_at timestamptz;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS no_before_after_confirmed_by text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS no_before_after_confirmed_at timestamptz;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS stop_requested_at timestamptz;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS stop_requested_reason text;
CREATE INDEX IF NOT EXISTS content_items_stop_requested_idx
  ON content_items (clinic_id) WHERE stop_requested_at IS NOT NULL AND status <> 'gestoppt';

-- Approval batches ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS content_approval_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  due_at      timestamptz NOT NULL,
  sent_by     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_approval_batches_due_check CHECK (due_at > sent_at)
);
CREATE INDEX IF NOT EXISTS content_approval_batches_clinic_idx
  ON content_approval_batches (clinic_id, sent_at);

CREATE TABLE IF NOT EXISTS content_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id         uuid NOT NULL REFERENCES content_approval_batches(id) ON DELETE CASCADE,
  content_item_id  uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  clinic_id        uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  token_hash       text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  -- Clone posts: only the Inhaber may decide (lib/content-gate.ts).
  inhaber_only     boolean NOT NULL DEFAULT false,
  decision         text,
  change_text      text,
  decided_at       timestamptz,
  decided_by_user_id uuid REFERENCES clinic_users(id) ON DELETE SET NULL,
  -- 'portal' | 'link'
  decided_via      text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_approvals_decision_check
    CHECK (decision IS NULL OR decision IN ('freigegeben','aenderung')),
  CONSTRAINT content_approvals_via_check
    CHECK (decided_via IS NULL OR decided_via IN ('portal','link')),
  CONSTRAINT content_approvals_decided_check
    CHECK ((decision IS NULL) = (decided_at IS NULL) AND (decision IS NULL) = (decided_via IS NULL)),
  CONSTRAINT content_approvals_change_text_check
    CHECK (decision IS DISTINCT FROM 'aenderung' OR (change_text IS NOT NULL AND btrim(change_text) <> '')),
  CONSTRAINT content_approvals_token_uniq UNIQUE (token_hash),
  CONSTRAINT content_approvals_batch_item_uniq UNIQUE (batch_id, content_item_id)
);
CREATE INDEX IF NOT EXISTS content_approvals_item_idx ON content_approvals (content_item_id, created_at);
-- At most one open request per post: a post is in at most one undecided batch.
CREATE UNIQUE INDEX IF NOT EXISTS content_approvals_one_open_per_item
  ON content_approvals (content_item_id) WHERE decision IS NULL;

-- Verzug link ----------------------------------------------------------------
ALTER TABLE guarantee_delays ADD COLUMN IF NOT EXISTS approval_batch_id uuid
  REFERENCES content_approval_batches(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS guarantee_delays_approval_batch_uniq
  ON guarantee_delays (approval_batch_id) WHERE approval_batch_id IS NOT NULL;

-- Clone records --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clone_records (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id               uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  -- Person whose face and voice the clone uses (normally the Inhaber).
  person_name             text NOT NULL,
  tool                    text NOT NULL,
  consent_signed_at       timestamptz,
  consent_document_key    text,
  training_optout_document_key text,
  training_optout_confirmed_at timestamptz,
  model_created_at        timestamptz,
  revoked_at              timestamptz,
  revoked_note            text,
  contract_end_on         date,
  deleted_at              timestamptz,
  deleted_note            text,
  created_by              text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clone_records_consent_doc_check
    CHECK (consent_signed_at IS NULL OR consent_document_key IS NOT NULL),
  -- Betriebspflicht (07.10.2026): no model without the tool's training opt-out.
  CONSTRAINT clone_records_model_needs_optout_check
    CHECK (model_created_at IS NULL
           OR (training_optout_document_key IS NOT NULL AND training_optout_confirmed_at IS NOT NULL)),
  CONSTRAINT clone_records_model_needs_consent_check
    CHECK (model_created_at IS NULL OR consent_signed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS clone_records_clinic_idx ON clone_records (clinic_id);

-- Row level security -------------------------------------------------------
ALTER TABLE content_approval_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approval_batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_approval_batches_tenant_read ON content_approval_batches;
CREATE POLICY content_approval_batches_tenant_read ON content_approval_batches
  FOR SELECT USING (clinic_id = app_current_clinic());

ALTER TABLE content_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_approvals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_approvals_tenant_read ON content_approvals;
CREATE POLICY content_approvals_tenant_read ON content_approvals
  FOR SELECT USING (clinic_id = app_current_clinic());

ALTER TABLE clone_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    REVOKE ALL ON content_approval_batches, content_approvals FROM eins_app;
    GRANT SELECT ON content_approval_batches, content_approvals TO eins_app;
    REVOKE ALL ON clone_records FROM eins_app;
  END IF;
END
$$;
