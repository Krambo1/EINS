-- Email + Passwort als primärer Auth-Pfad.
--
-- Heute: Login nur via Magic-Link, danach Pflicht-TOTP. Klar zu reibig für den
-- Alltag. Diese Migration fügt einen Passwort-Hash an clinic_users + admin_users
-- an, erweitert die magic_links-Intents um set_password / reset_password, und
-- legt eine polymorphe trusted_devices-Tabelle an, damit der zweite Faktor pro
-- Browser für 30 Tage erinnerbar ist.
--
-- Rückwärtskompatibel:
--   * password_hash ist NULLABLE. Bestehende User ohne Passwort bekommen beim
--     ersten Login-Versuch (Email-only) automatisch einen Set-Password-Magic-
--     Link in die Inbox -- /login leitet auf den klassischen Flow um.
--   * mfa_enrolled bleibt opt-in. Niemand wird mehr force-enrolled.
--
-- Tabelle trusted_devices ist polymorph (kind in 'clinic' | 'admin') statt zwei
-- Tabellen, weil das Verhalten 1:1 identisch ist. Ohne FK auf user_id, weil
-- clinic_users und admin_users disjunkte Identitäten sind.

SET statement_timeout = 0;
SET lock_timeout = 0;

-- -------------------------------------------------------------------
-- clinic_users + admin_users: password_hash
-- -------------------------------------------------------------------
ALTER TABLE clinic_users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

ALTER TABLE admin_users
  ADD COLUMN IF NOT EXISTS password_hash text,
  ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

-- -------------------------------------------------------------------
-- magic_links: erweiterte intents
-- -------------------------------------------------------------------
ALTER TABLE magic_links
  DROP CONSTRAINT IF EXISTS magic_links_intent_check;

ALTER TABLE magic_links
  ADD CONSTRAINT magic_links_intent_check
  CHECK (intent IN ('login', 'invite', 'set_password', 'reset_password'));

-- -------------------------------------------------------------------
-- trusted_devices: pro Browser + User für 30 Tage gemerkter zweiter Faktor
-- -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trusted_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'clinic' verweist logisch auf clinic_users.id, 'admin' auf admin_users.id.
  -- Bewusst keine FK -- die beiden User-Tabellen sind disjunkt und wir wollen
  -- weder kaskadieren noch zwei separate Tabellen führen.
  kind          text NOT NULL CHECK (kind IN ('clinic', 'admin')),
  user_id       uuid NOT NULL,
  token_hash    text NOT NULL UNIQUE,
  label         text,
  user_agent    text,
  ip_address    inet,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz
);

CREATE INDEX IF NOT EXISTS trusted_devices_user_idx
  ON trusted_devices (kind, user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS trusted_devices_expiry_idx
  ON trusted_devices (expires_at)
  WHERE revoked_at IS NULL;
