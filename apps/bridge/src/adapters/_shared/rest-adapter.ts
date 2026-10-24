import type { Adapter, AdapterPollResult, AdapterRunContext } from "../Adapter.js";
import type { PvsLinkRow } from "../../db/client.js";
import type { CanonicalEvent } from "../../canonical/types.js";
import { DEFAULT_MAX_PAGES } from "./paging.js";
import { resolveTimezone } from "./iso.js";
import {
  initialChunks,
  pollChunks,
  seedCursors,
  type StreamSource,
} from "./stream-sync.js";

/**
 * The sync half of a REST polling adapter, built from the vendor's stream
 * sources. tomedo / pabau / consentz differ only in their client + normalizers
 * (the sources); cursor handling, overlap, clamping, paging caps, chunking and
 * resume all live in stream-sync.ts.
 */

export interface RestSyncConfig {
  /** Build the five stream sources for one link. `signal` must reach every fetch. */
  makeSources(link: PvsLinkRow, signal: AbortSignal | undefined, timezone: string): StreamSource[];
}

/** connection_config.maxPagesPerPoll (1..1000), else the default cap of 50. */
export function maxPagesFor(link: PvsLinkRow): number {
  const v = (link.connectionConfig as { maxPagesPerPoll?: unknown } | undefined)?.maxPagesPerPoll;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000
    ? v
    : DEFAULT_MAX_PAGES;
}

export function restSyncMethods(
  cfg: RestSyncConfig
): Pick<Adapter, "poll" | "pollChunks" | "initialChunks" | "initialSync" | "seedCursor"> {
  const pollStream = (link: PvsLinkRow, cursor: string | null, ctx: AdapterRunContext = {}) => {
    const tz = resolveTimezone(link.connectionConfig);
    return pollChunks(cfg.makeSources(link, ctx.signal, tz), cursor, {
      signal: ctx.signal,
      now: ctx.now ?? new Date(),
      timezone: tz,
      maxPages: maxPagesFor(link),
      deadlineAt: ctx.deadlineAt,
      failedStreams: ctx.failedStreams,
    });
  };
  return {
    pollChunks: pollStream,

    initialChunks(link, state, ctx = {}) {
      const tz = resolveTimezone(link.connectionConfig);
      return initialChunks(cfg.makeSources(link, ctx.signal, tz), state, { signal: ctx.signal });
    },

    /** Non-resumable view of the initial sync (the all-or-nothing Adapter
     *  contract); the scheduler prefers initialChunks. */
    async *initialSync(link, sinceIso): AsyncIterable<CanonicalEvent> {
      const tz = resolveTimezone(link.connectionConfig);
      const state = { v: 1 as const, start: new Date().toISOString(), since: sinceIso, i: 0, p: null };
      for await (const chunk of initialChunks(cfg.makeSources(link, undefined, tz), state, {})) {
        for (const e of chunk.events) yield e;
      }
    },

    /** Buffered view of pollChunks (legacy contract / tests). The scheduler
     *  streams via pollChunks instead of buffering a whole poll in memory. */
    async poll(link, cursor, ctx): Promise<AdapterPollResult> {
      const events: CanonicalEvent[] = [];
      let nextCursor: string | null = null;
      for await (const chunk of pollStream(link, cursor, ctx)) {
        for (const e of chunk.events) events.push(e);
        if (chunk.cursor) nextCursor = chunk.cursor;
      }
      return {
        events,
        nextCursor,
        recommendedDelayMs: events.length === 0 ? 5 * 60_000 : 60_000,
      };
    },

    seedCursor: seedCursors,
  };
}
