import type { Adapter } from "../adapters/Adapter.js";
import type { PvsLinkRow } from "../db/client.js";
import { postBatch } from "../portal-client.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * Drive an adapter's initialSync iterator and POST events to the portal in
 * batches. Invoked by the scheduler (C7) for every connected link whose
 * pvs_sync_status.last_initial_sync_completed_at is still NULL: yields
 * back a summary the scheduler uses to decide completion.
 *
 * Failure semantics: a rejected batch THROWS (aborting the sync); per-event
 * errors reported by the portal accumulate in `errors`, and the scheduler
 * refuses to mark the sync complete when errors > 0. Either way the sync
 * re-runs from the top on retry and the portal dedup absorbs the overlap.
 *
 * The batch size is intentionally lower than postBatch's hard cap (500)
 * because initial-sync events tend to be larger payloads (FHIR Bundles
 * include patient + appointment + encounter inline) and we want to keep
 * each HTTP request under ~1 MB to stay clear of any intermediate proxies.
 */

const INITIAL_SYNC_BATCH = 200;

export interface InitialSyncReport {
  totalProcessed: number;
  ingested: number;
  deduped: number;
  errors: number;
  elapsedMs: number;
}

export async function runInitialSync(
  link: PvsLinkRow,
  adapter: Adapter,
  sinceIso: string
): Promise<InitialSyncReport> {
  const startedAt = Date.now();
  let totalProcessed = 0;
  let ingested = 0;
  let deduped = 0;
  let errors = 0;

  let buffer: CanonicalEvent[] = [];
  const flush = async () => {
    if (buffer.length === 0) return;
    const r = await postBatch(link.clinicId, buffer);
    if (!r.ok) {
      // C7: a rejected batch ABORTS the sync instead of being counted and
      // skipped: continuing would let a sync "complete" with whole
      // batches missing, and (portal down) would pound through the entire
      // history for nothing. The scheduler records the failure and retries
      // the whole sync later; portal dedup absorbs the re-posts.
      throw new Error(
        `portal rejected batch of ${buffer.length} event(s): http ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`
      );
    }
    const b = r.body as {
      ingested?: number;
      deduped?: number;
      errors?: unknown[];
    };
    ingested += b.ingested ?? 0;
    deduped += b.deduped ?? 0;
    errors += b.errors?.length ?? 0;
    buffer = [];
  };

  for await (const event of adapter.initialSync(link, sinceIso)) {
    buffer.push(event);
    totalProcessed += 1;
    if (buffer.length >= INITIAL_SYNC_BATCH) {
      await flush();
    }
  }
  await flush();

  return {
    totalProcessed,
    ingested,
    deduped,
    errors,
    elapsedMs: Date.now() - startedAt,
  };
}
