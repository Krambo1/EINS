// Vitest setup — populate the env vars the portal validates at import time
// so test files can import any module without tripping @t3-oss/env-nextjs.
// Dummy values; never used by tests since DB/Redis/etc. are mocked.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://test:test@127.0.0.1:5432/eins_portal";
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? "0".repeat(64); // 64 hex chars
process.env.ENCRYPTION_KEY =
  process.env.ENCRYPTION_KEY ?? "0".repeat(64); // 64 hex chars (32 bytes)
process.env.APP_ORIGIN = process.env.APP_ORIGIN ?? "http://localhost:3001";
process.env.CLINIC_LANDING_ORIGIN =
  process.env.CLINIC_LANDING_ORIGIN ?? "http://localhost:3002";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.SKIP_ENV_VALIDATION = "1";
