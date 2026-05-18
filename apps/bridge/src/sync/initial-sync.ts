import type { Adapter } from "../adapters/Adapter.js";
import type { PvsLinkRow } from "../db/client.js";
import { postBatch } from "../portal-client.js";
import type { CanonicalEvent } from "../canonical/types.js";

/**
 * Drive an adapter's initialSync iterator and POST events to the portal in
 * batches. Used once per pvs_link when an inhaber connects a new PVS — yields
 * back a summary the bridge logs as the "first sync" outcome.
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
      errors += buffer.length;
    } else {
      const b = r.body as {
        ingested?: number;
        deduped?: number;
        errors?: unknown[];
      };
      ingested += b.ingested ?? 0;
      deduped += b.deduped ?? 0;
      errors += b.errors?.length ?? 0;
    }
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
