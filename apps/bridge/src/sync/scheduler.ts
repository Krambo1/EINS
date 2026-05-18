import { env } from "../config.js";
import { loadDueLinks, checkpointSync, recordFailure } from "../db/client.js";
import type { Adapter } from "../adapters/Adapter.js";
import { postAll } from "../portal-client.js";
import { tomedoAdapter } from "../adapters/tomedo/index.js";

/**
 * Bridge sync scheduler.
 *
 * Ticks every SCHEDULER_TICK_MS (30s default), pulls `pvs_link` rows
 * whose `next_poll_at <= now` AND whose vendor is a polling adapter
 * (Tomedo only), and runs incremental-poll for each.
 *
 * Push adapters (HealthHub, RED) bypass the scheduler — their events
 * arrive via inbound webhooks and are dispatched directly to postEvent.
 */

const ADAPTERS: Record<string, Adapter | undefined> = {
  tomedo: tomedoAdapter,
};

export function startScheduler(): { stop: () => void } {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  async function tick() {
    if (stopped) return;
    try {
      const due = await loadDueLinks(new Date());
      for (const link of due) {
        const adapter = ADAPTERS[link.pvsVendor];
        if (!adapter || !adapter.poll) continue;
        await runPoll(link, adapter);
      }
    } catch (err) {
      console.error("[scheduler] tick failed:", err);
    } finally {
      if (!stopped) {
        timer = setTimeout(tick, env().SCHEDULER_TICK_MS);
      }
    }
  }
  timer = setTimeout(tick, env().SCHEDULER_TICK_MS);
  console.log(
    `[scheduler] started, tick every ${env().SCHEDULER_TICK_MS}ms`
  );
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

async function runPoll(
  link: import("../db/client.js").PvsLinkRow,
  adapter: Adapter
): Promise<void> {
  const startedAt = Date.now();
  try {
    const cursor =
      typeof link.connectionConfig?.lastCursor === "string"
        ? (link.connectionConfig.lastCursor as string)
        : null;
    const result = await adapter.poll!(link, cursor);
    const out = await postAll(link.clinicId, result.events);
    const nextDelay =
      result.recommendedDelayMs ?? 60_000;
    await checkpointSync(link.id, {
      cursor: result.nextCursor,
      eventsIngested: out.ingested,
      nextPollAt: new Date(Date.now() + nextDelay),
    });
    console.log(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} ` +
        `events=${result.events.length} ingested=${out.ingested} ` +
        `deduped=${out.deduped} errors=${out.errors} ` +
        `nextIn=${nextDelay}ms (${Date.now() - startedAt}ms)`
    );
  } catch (err) {
    const msg = (err as Error).message;
    console.error(
      `[scheduler] ${link.pvsVendor}/${link.clinicId} failed:`,
      msg
    );
    await recordFailure(link.id, msg, env().FAIL_THRESHOLD);
  }
}
