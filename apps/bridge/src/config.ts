import { z } from "zod";

/**
 * Bridge environment surface. All env vars are validated at startup so
 * the process fails-fast rather than silently mis-configuring an adapter.
 *
 * APP_KEY: the same hex AES-256 key used by apps/portal (32 bytes hex).
 *   The Bridge needs to decrypt the per-clinic 'pvs' HMAC secret stored
 *   in platform_credentials. Shared-key model is the simplest deployment;
 *   in higher-security setups swap to a secret-broker endpoint exposed
 *   by the portal.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BRIDGE_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  PORTAL_BASE_URL: z.string().url().default("http://localhost:3001"),
  BRIDGE_PUBLIC_URL: z.string().url().default("https://bridge.einsvisuals.de"),
  APP_KEY: z
    .string()
    .min(64, "APP_KEY must be 32 bytes hex (= 64 hex chars)")
    .max(64),
  PORT: z.coerce.number().int().positive().default(7300),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),
  /** Max consecutive failures before pvs_link.status → 'error'. */
  FAIL_THRESHOLD: z.coerce.number().int().positive().default(10),
});

export type BridgeEnv = z.infer<typeof schema>;

let cached: BridgeEnv | null = null;
export function env(): BridgeEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("❌ Bridge env validation failed:", parsed.error.issues);
    process.exit(1);
  }
  cached = parsed.data;
  return cached;
}
