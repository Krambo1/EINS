import "./load-env.js";
import { env } from "./config.js";
import { startInbound } from "./inbound/server.js";
import { startScheduler } from "./sync/scheduler.js";

/**
 * Bridge entry point.
 *
 * Boots both the Fastify inbound server (HealthHub + RED webhooks) and
 * the scheduler tick loop (Tomedo polling). One process, two
 * concurrent loops. Graceful shutdown on SIGTERM/SIGINT.
 */

/** How long shutdown waits for in-flight links to give their leases back. The
 *  deploy platform's kill timeout must be at least this long (fly.toml
 *  kill_timeout), or the process is killed first. */
const SHUTDOWN_WAIT_MS = 25_000;

async function main(): Promise<void> {
  // Read env to validate it (fails fast).
  const cfg = env();
  console.log(
    `[bridge] starting, NODE_ENV=${cfg.NODE_ENV} portal=${cfg.PORTAL_BASE_URL} port=${cfg.PORT}`
  );

  const inbound = await startInbound();
  const scheduler = startScheduler();

  const shutdown = async (signal: string) => {
    console.log(`[bridge] received ${signal}, shutting down…`);
    // stop() aborts in-flight link work; each aborted link then releases its
    // claim lease. Give that a moment to finish before the process exits,
    // otherwise the leases stay held until they expire (up to 11 minutes).
    scheduler.stop();
    await scheduler.idle(SHUTDOWN_WAIT_MS);
    await inbound.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[bridge] fatal:", err);
  process.exit(1);
});
