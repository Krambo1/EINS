import type { Adapter } from "../adapters/Adapter.js";
import type { PvsLinkRow } from "../db/client.js";
import { PACE_MS, addOut, newStats, postChunkWithRetry, type SyncStats } from "./post-chunk.js";
import { POST_CHUNK } from "../portal-client.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * All-or-nothing initial-sync driver for adapters WITHOUT resumable chunks
 * (the push adapters healthhub / red, which backfill through a FHIR search
 * iterator). It streams adapter.initialSync into paced batches and reports.
 *
 * The REST adapters (tomedo, pabau, consentz) do not come through here: they
 * implement Adapter.initialChunks and the scheduler drives them resumably
 * (progress persisted after every accepted page, bounded time per run).
 *
 * Failure semantics: events the portal PERMANENTLY rejects are skipped and
 * counted (they can never succeed, so they must not hold the sync hostage);
 * events that fail retryably (network, 429/5xx, link_not_ready ...) make the
 * run THROW with HTTP status + reason, so the scheduler records the failure and
 * retries the whole sync (portal dedup absorbs the re-posts).
 */

export interface InitialSyncReport extends SyncStats {
  totalProcessed: number;
  /** Retryable failures; the scheduler refuses completion when > 0. */
  errors: number;
  elapsedMs: number;
  failure?: string;
}

export async function runInitialSync(
  link: PvsLinkRow,
  adapter: Adapter,
  sinceIso: string,
  opts: { signal?: AbortSignal; paceMs?: number } = {}
): Promise<InitialSyncReport> {
  const startedAt = Date.now();
  const stats = newStats();
  let totalProcessed = 0;
  let errors = 0;
  let failure: string | undefined;

  let buffer: CanonicalEvent[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const out = await postChunkWithRetry(link.clinicId, buffer, {
      signal: opts.signal,
      paceMs: opts.paceMs ?? PACE_MS,
    });
    addOut(stats, out);
    if ((out.errors ?? 0) > 0) {
      // C7: abort instead of counting and skipping: continuing would let a sync
      // "complete" with whole batches missing (and, portal down, would pound
      // through the entire history for nothing).
      errors += out.errors;
      failure = out.failure;
      throw new Error(
        `portal did not accept ${out.errors} event(s) of a ${buffer.length}-event batch (${out.failure ?? "unknown"})`
      );
    }
    buffer = [];
  };

  for await (const event of adapter.initialSync(link, sinceIso)) {
    buffer.push(event);
    totalProcessed += 1;
    if (buffer.length >= POST_CHUNK) await flush();
  }
  await flush();

  return { ...stats, totalProcessed, errors, failure, elapsedMs: Date.now() - startedAt };
}
