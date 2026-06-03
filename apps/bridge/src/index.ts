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
    scheduler.stop();
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
