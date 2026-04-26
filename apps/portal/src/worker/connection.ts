import Redis from "ioredis";
import { env } from "@/lib/env";

/**
 * Redis connection for the BullMQ WORKER process (separate from the producer
 * connection in `src/server/jobs.ts`). Workers block on `BLPOP`, so they need
 * `maxRetriesPerRequest: null`.
 */
let conn: Redis | undefined;

export function workerConnection(): Redis {
  if (!conn) {
    conn = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    conn.on("error", (err) => {
      console.error("[worker][redis]", err.message);
    });
    conn.on("connect", () => {
      console.log("[worker][redis] connected");
    });
  }
  return conn;
}
