-- Core extensions required by the EINS Portal schema.
-- Loaded automatically on first container boot by postgres-alpine.
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- AES for OAuth tokens + gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS citext;     -- case-insensitive emails
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- defensive, some tooling expects it

-- Application role used by the portal app (separate from superuser).
-- Password is dev-only; swap via secrets in production.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eins_app') THEN
    CREATE ROLE eins_app LOGIN PASSWORD 'eins_app_dev' NOINHERIT;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE eins_portal TO eins_app;
GRANT USAGE ON SCHEMA public TO eins_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eins_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eins_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eins_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO eins_app;
