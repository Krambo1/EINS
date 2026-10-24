import { postAll, type PostAllResult } from "../portal-client.js";
import type { CanonicalEvent } from "../canonical/types.js";
import { abortableSleep } from "../adapters/_shared/paging.js";

/**
 * Posting + accounting helpers shared by the poll path and the initial-sync
 * path, so both apply the same retry / skip / blocking rules.
 */

/** Minimum gap between batch POSTs per clinic: the portal allows 60 batches per
 *  10 minutes per clinic, i.e. one per 10 s sustained. */
export const PACE_MS = 10_000;

export interface SyncStats {
  ingested: number;
  deduped: number;
  quarantined: number;
  /** Events the portal permanently rejected (skipped, cursor passes them). */
  skipped: number;
  skippedByReason: Record<string, number>;
  /** Events dropped by the pre-flight sanitiser (never sent). */
  dropped: number;
  droppedByReason: Record<string, number>;
  /** Vendor rows the normalizer could not turn into events. */
  skippedRows: number;
}

export function newStats(): SyncStats {
  return {
    ingested: 0,
    deduped: 0,
    quarantined: 0,
    skipped: 0,
    skippedByReason: {},
    dropped: 0,
    droppedByReason: {},
    skippedRows: 0,
  };
}

function mergeCounts(into: Record<string, number>, from: Record<string, number> | undefined): void {
  for (const [k, v] of Object.entries(from ?? {})) into[k] = (into[k] ?? 0) + v;
}

/** Fold one postAll result into the running stats. Tolerates partial results. */
export function addOut(stats: SyncStats, out: Partial<PostAllResult>): void {
  stats.ingested += out.ingested ?? 0;
  stats.deduped += out.deduped ?? 0;
  stats.quarantined += out.quarantined ?? 0;
  stats.skipped += out.skipped ?? 0;
  stats.dropped += out.dropped ?? 0;
  mergeCounts(stats.skippedByReason, out.skippedByReason);
  mergeCounts(stats.droppedByReason, out.droppedByReason);
}

export function topReasons(counts: Record<string, number>, n = 5): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} x${v}`)
    .join(", ");
}

/** Portal verdicts that are an operator choice, not a statement about the row. */
const NOT_A_REJECT = new Set(["billing_conflict"]);

/**
 * Events of one posted chunk that can never be delivered as they are: dropped by
 * the pre-flight sanitiser, or permanently refused by the portal (invalid_envelope,
 * clinic_mismatch, invalid_bridge_source, vendor_mismatch ...). billing_conflict is
 * NOT one: the practice chose another billing source on purpose. Rows the
 * normalizer skips (an invoice that is not paid yet) never reach this count.
 */
export function countRejects(out: Partial<PostAllResult>): {
  count: number;
  byReason: Record<string, number>;
} {
  const byReason: Record<string, number> = {};
  let count = out.dropped ?? 0;
  mergeCounts(byReason, out.droppedByReason);
  for (const [reason, n] of Object.entries(out.skippedByReason ?? {})) {
    if (NOT_A_REJECT.has(reason)) continue;
    count += n;
    byReason[reason] = (byReason[reason] ?? 0) + n;
  }
  return { count, byReason };
}

/**
 * Non-fatal summary of what was skipped on an otherwise successful run (null
 * if nothing was). Reasons only, never values: no patient data in last_error.
 */
export function describeSkips(stats: SyncStats): string | null {
  const parts: string[] = [];
  if (stats.skipped > 0) {
    parts.push(
      `${stats.skipped} event(s) permanently rejected by the portal and skipped (${topReasons(stats.skippedByReason)})`
    );
  }
  if (stats.dropped > 0) {
    parts.push(
      `${stats.dropped} invalid event(s) dropped before sending (${topReasons(stats.droppedByReason)})`
    );
  }
  if (stats.skippedRows > 0) {
    parts.push(`${stats.skippedRows} vendor row(s) produced no event`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

export interface PostChunkOptions {
  signal?: AbortSignal;
  paceMs?: number;
  /** Retry the chunk after a portal 429 up to this many times. */
  maxRateLimitRetries?: number;
  /** Do not wait longer than this for a Retry-After. */
  maxWaitMs?: number;
}

/**
 * postAll for one chunk, sleeping through a portal 429 (up to its Retry-After)
 * and re-sending the chunk: the portal dedups what already went in. ingested
 * accumulates across attempts (the earlier successes become "deduped" on the
 * resend); everything else reflects the final attempt.
 */
export async function postChunkWithRetry(
  clinicId: string,
  events: CanonicalEvent[],
  opts: PostChunkOptions = {}
): Promise<PostAllResult> {
  const maxRetries = opts.maxRateLimitRetries ?? 3;
  const maxWait = opts.maxWaitMs ?? 120_000;
  let ingestedBefore = 0;
  for (let attempt = 0; ; attempt++) {
    const out = await postAll(clinicId, events, { signal: opts.signal, paceMs: opts.paceMs });
    const rateLimited =
      (out.errors ?? 0) > 0 && out.retryAfterMs !== undefined && out.retryAfterMs <= maxWait;
    if (!rateLimited || attempt >= maxRetries) {
      return { ...out, ingested: (out.ingested ?? 0) + ingestedBefore };
    }
    ingestedBefore += out.ingested ?? 0;
    await abortableSleep(Math.max(out.retryAfterMs!, 1_000), opts.signal);
  }
}
