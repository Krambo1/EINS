import type { CanonicalEvent } from "../canonical/types.js";
import type { PvsLinkRow } from "../db/client.js";

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
 * Errors thrown from any method propagate to the scheduler, which records
 * a failure and pushes `pvs_link.status='error'` after FAIL_THRESHOLD
 * consecutive failures.
 */

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
    cursor: string | null
  ): Promise<AdapterPollResult>;

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
