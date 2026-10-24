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
  PORTAL_BASE_URL: z.string().url().default("http://localhost:3001"),
  BRIDGE_PUBLIC_URL: z.string().url().default("https://bridge.eins.ag"),
  APP_KEY: z
    .string()
    .min(64, "APP_KEY must be 32 bytes hex (= 64 hex chars)")
    .max(64),
  PORT: z.coerce.number().int().positive().default(7300),
  SCHEDULER_TICK_MS: z.coerce.number().int().positive().default(30_000),
  /** Consecutive failures after which a link's retry backoff settles at its
   *  slowest cadence (15 min) and one loud log line is emitted. The bridge no
   *  longer writes pvs_link.status='error' (the portal would reject every event
   *  for such a link, so it could never recover); the failing state lives in
   *  pvs_sync_status.last_error / consecutive_failure_count and /healthz. */
  FAIL_THRESHOLD: z.coerce.number().int().positive().default(10),
  /** Links the scheduler works on concurrently (a slow vendor must not stall
   *  every other Praxis). */
  SCHEDULER_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(3),
  /** HealthHub is a shelved vendor (medatixx akkreditierung pending): its
   *  webhook route is only registered when this is "true". Default off. */
  ENABLE_HEALTHHUB_WEBHOOK: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((v) => v === "true" || v === "1"),
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
