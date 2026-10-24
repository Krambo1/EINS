import type { CanonicalEvent } from "../canonical/types.js";
import type { PvsLinkRow } from "../db/client.js";
import type { InitialSyncState, SyncChunk } from "./_shared/stream-sync.js";

/**
 * Adapter contract. Each PVS vendor implements a subset of these methods:
 *
 *   Polling adapters (Tomedo)
 *     • connect, initialSync, poll
 *
 *   Push adapters (HealthHub, RED — FHIR Subscriptions)
 *     • connect, initialSync, decodePush
 *
 * `decodePush` is invoked from the Fastify inbound route, NOT the scheduler.
 *
 * `initialSync` yields events as an AsyncIterable so the caller can stream
 * them straight into postBatch without buffering 50k rows in memory.
 *
 * Errors thrown from any method propagate to the scheduler, which records the
 * failure in pvs_sync_status (last_error, consecutive_failure_count) and retries
 * with backoff. The bridge never writes pvs_link.status='error': the portal
 * rejects every event for such a link, so it could not recover.
 */

/** Per-call context the scheduler hands to an adapter. */
export interface AdapterRunContext {
  /** Aborted on the scheduler's wall-clock deadline or on shutdown. Adapters
   *  must pass it to every fetch so a deadline CANCELS the work. */
  signal?: AbortSignal;
  /** Poll start time (clamp for the next cursor). Default: now. */
  now?: Date;
  /** Epoch ms after which a streaming poll should stop pulling new pages and
   *  persist where it stopped (the poll's time budget, a bit earlier than the
   *  hard deadline that aborts the signal). */
  deadlineAt?: number;
  /** Streams the scheduler has rejected during this poll. The adapter stops
   *  reading them and leaves their watermark unchanged. Mutated by the
   *  scheduler while the poll runs. */
  failedStreams?: ReadonlySet<string>;
}

export interface AdapterPollResult {
  events: CanonicalEvent[];
  /** Cursor token to persist for the next call. null = no advance. */
  nextCursor: string | null;
  /** Approximate "no new events for at least this long" hint, in ms.
   *  Defaults to 60_000 if absent. */
  recommendedDelayMs?: number;
}

export interface Adapter {
  vendor: "tomedo" | "healthhub" | "red" | "pabau" | "consentz";

  /**
   * Sanity-check the link's credentials. Called once per (re)configuration
   * and during the scheduler's health checks.
   */
  connect(link: PvsLinkRow): Promise<
    { ok: true } | { ok: false; reason: string }
  >;

  /**
   * Pull historical data (default: 12 months back, configurable per-link
   * via connection_config.initialSyncMonths). Used once on first connect.
   *
   * Generator semantics: yield in chronological order so the portal-side
   * status-derive worker sees coherent state at every checkpoint.
   */
  initialSync(
    link: PvsLinkRow,
    sinceIso: string
  ): AsyncIterable<CanonicalEvent>;

  /**
   * Incremental poll (Tomedo only). cursor is the last-seen modified-at
   * token; null on first call. Returns events plus a nextCursor to persist.
   */
  poll?(
    link: PvsLinkRow,
    cursor: string | null,
    ctx?: AdapterRunContext
  ): Promise<AdapterPollResult>;

  /**
   * Streaming incremental poll (preferred by the scheduler over `poll`): yields
   * one chunk per vendor page; the scheduler posts a chunk's events, then (when
   * chunk.cursor is set) checkpoints, before pulling the next chunk. Memory is
   * bounded by one page and a failure mid-poll keeps the progress made so far.
   */
  pollChunks?(
    link: PvsLinkRow,
    cursor: string | null,
    ctx?: AdapterRunContext
  ): AsyncIterable<SyncChunk>;

  /**
   * Resumable initial sync: yields one chunk per vendor page, each carrying the
   * resume token (see InitialSyncState) for the NEXT page. The scheduler
   * persists the token after every accepted chunk and passes it back in after a
   * restart. Adapters without it fall back to the all-or-nothing `initialSync`.
   */
  initialChunks?(
    link: PvsLinkRow,
    state: InitialSyncState,
    ctx?: AdapterRunContext
  ): AsyncIterable<SyncChunk>;

  /**
   * Build the adapter's cursor token representing "everything before
   * syncStartIso has been seen". Called once when an initial sync
   * completes (C7): the scheduler seeds pvs_sync_status with this value so
   * the first incremental poll picks up at the initial-sync watermark
   * instead of re-downloading history from the epoch. Polling adapters
   * must implement this; push adapters may omit it.
   */
  seedCursor?(syncStartIso: string): string;

  /**
   * Decode an inbound push webhook (HealthHub, RED). The Fastify route
   * has already verified the vendor-side signature; this method just
   * translates the FHIR Bundle into canonical events.
   */
  decodePush?(
    link: PvsLinkRow,
    rawBody: string,
    headers: Record<string, string>
  ): CanonicalEvent[];
}
