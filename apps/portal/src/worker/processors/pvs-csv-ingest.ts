import { and, asc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { getStorage } from "@/server/storage";
import { applyPvsEvent } from "@/server/pvs-events";
import { planCsvRows, CsvMappingSchema } from "@/server/pvs-csv-mapper";
import { parseCsvBuffer } from "@/server/pvs-csv-parse";
import { describeErrorForLog } from "@/lib/error-log";

/**
 * PVS Bridge — CSV ingest worker.
 *
 * Reads `pvs_csv_uploads.storage_key`, parses the CSV, applies the user's
 * column mapping, and calls applyPvsEvent in-process for each translated
 * canonical event. Progress is written back to the upload row so the
 * wizard UI's polling loop can render a progress bar.
 *
 * In-process apply (no HTTP roundtrip): the CSV path is internal/trusted —
 * the inhaber uploaded the file through an authenticated session, and we
 * already validated stream + mapping at the server-action layer. Skipping
 * HMAC verification halves the latency at 5k+ row uploads.
 *
 * Failure handling: ALL rows are validated first (pure, nothing written).
 * If more than 5% of rows fail, nothing is applied and the upload is marked
 * `failed` with the per-row errors. Otherwise the valid events are applied
 * and the upload is `completed` with counts attached for the UI. Invoices
 * already delivered by a live PVS source are skipped, not double counted.
 *
 * C8 (2026-10-08), runs without the worker: the server action runs this
 * inline via after(), /api/cron/daily + /api/cron/morning catch up
 * (catchUpPvsCsvIngest), and the pg-boss worker may run it too. Every runner
 * first takes an atomic claim on the upload row (claimed_at +
 * ingest_attempts, migration 0095), so one file is never processed twice at
 * the same time. A claim older than CSV_INGEST_STALE_MINUTES counts as dead
 * (function timeout, crash) and may be taken again; progress refreshes it.
 * After CSV_INGEST_MAX_ATTEMPTS claims the upload is marked failed. A retry
 * after a partial run is safe: applyPvsEvent dedupes replayed events.
 */

export interface PvsCsvIngestJob {
  uploadId: string;
}

const HARD_FAIL_RATIO = 0.05; // >5% errors → mark upload failed

/** A claim older than this counts as dead and may be taken again. */
export const CSV_INGEST_STALE_MINUTES = 15;
/** Claims per upload (inline run + cron catch-ups) before it is failed. */
export const CSV_INGEST_MAX_ATTEMPTS = 4;

/** Shown in the wizard's failure details; no file content, no patient data. */
export const ATTEMPTS_EXHAUSTED_MESSAGE =
  "Die Datei konnte nach mehreren Versuchen nicht vollständig verarbeitet werden, " +
  "vermutlich ist sie zu groß für einen Durchgang. Bitte teilen Sie sie in kleinere " +
  "Dateien auf und laden Sie diese einzeln hoch. Bereits übernommene Rechnungen " +
  "werden dabei nicht doppelt gezählt.";

export type PvsCsvIngestOutcome =
  /** this run processed the file (status now completed or failed) */
  | "processed"
  /** another runner holds a fresh claim, or the upload is not 'processing' */
  | "not_claimed"
  /** attempt limit reached, upload marked failed */
  | "exhausted";

const t = schema.pvsCsvUploads;
const staleBefore = () =>
  sql`now() - (${CSV_INGEST_STALE_MINUTES}::int * interval '1 minute')`;
const claimFree = () => or(isNull(t.claimedAt), lt(t.claimedAt, staleBefore()));

/** Worker entry point (pg-boss handlers return void). */
export async function processPvsCsvIngest(
  job: PvsCsvIngestJob
): Promise<void> {
  await runPvsCsvIngest(job.uploadId);
}

/**
 * Claim the upload and process it. Safe to call from any runner at any time:
 * only the caller that wins the atomic claim does the work.
 */
export async function runPvsCsvIngest(
  uploadId: string
): Promise<PvsCsvIngestOutcome> {
  const [upload] = await db
    .update(t)
    .set({
      claimedAt: sql`now()`,
      ingestAttempts: sql`${t.ingestAttempts} + 1`,
    })
    .where(
      and(
        eq(t.id, uploadId),
        eq(t.status, "processing"),
        lt(t.ingestAttempts, CSV_INGEST_MAX_ATTEMPTS),
        claimFree()
      )
    )
    .returning({
      id: t.id,
      clinicId: t.clinicId,
      storageKey: t.storageKey,
      stream: t.stream,
      mappingJson: t.mappingJson,
    });

  if (!upload) {
    const exhausted = await db
      .update(t)
      .set({
        status: "failed",
        errorSummary: {
          reason: "attempts_exhausted",
          message: ATTEMPTS_EXHAUSTED_MESSAGE,
        },
        completedAt: new Date(),
      })
      .where(
        and(
          eq(t.id, uploadId),
          eq(t.status, "processing"),
          gte(t.ingestAttempts, CSV_INGEST_MAX_ATTEMPTS),
          claimFree()
        )
      )
      .returning({ id: t.id });
    if (exhausted.length > 0) {
      console.warn(`[pvs-csv-ingest] upload ${uploadId} failed: attempt limit reached`);
      return "exhausted";
    }
    return "not_claimed";
  }

  try {
    await ingestClaimed(upload);
    return "processed";
  } catch (err) {
    // Release the claim so the next runner may retry at once; the attempt
    // stays counted.
    await db
      .update(t)
      .set({ claimedAt: null })
      .where(and(eq(t.id, uploadId), eq(t.status, "processing")))
      .catch(() => undefined);
    console.error(
      JSON.stringify({
        scope: "pvs-csv-ingest",
        uploadId,
        error: describeErrorForLog(err),
      })
    );
    throw err;
  }
}

async function ingestClaimed(upload: {
  id: string;
  clinicId: string;
  storageKey: string;
  stream: string;
  mappingJson: unknown;
}): Promise<void> {
  const uploadId = upload.id;

  const mappingParse = CsvMappingSchema.safeParse(upload.mappingJson);
  if (!mappingParse.success) {
    await fail(uploadId, {
      reason: "invalid_mapping",
      issues: mappingParse.error.issues.slice(0, 5),
    });
    return;
  }
  const mapping = mappingParse.data;

  // Read the raw bytes from storage and parse.
  let rows: Record<string, string>[];
  try {
    const buffer = await getStorage().read(upload.storageKey);
    rows = parseCsvBuffer(buffer).rows;
  } catch (err) {
    await fail(uploadId, { reason: "read_or_parse_failed", message: String(err) });
    return;
  }

  await db
    .update(schema.pvsCsvUploads)
    .set({
      totalRows: rows.length,
      startedAt: new Date(),
      claimedAt: sql`now()`,
    })
    .where(eq(schema.pvsCsvUploads.id, uploadId));

  // Phase 1: validate everything, pure.
  const plan = planCsvRows({
    clinicId: upload.clinicId,
    uploadId: upload.id,
    rows,
    mapping,
  });
  if (plan.fatal) {
    await fail(uploadId, { reason: plan.fatal });
    return;
  }

  const errors = [...plan.errors];
  const errorRatio = rows.length === 0 ? 0 : errors.length / rows.length;
  if (errorRatio > HARD_FAIL_RATIO) {
    await db
      .update(schema.pvsCsvUploads)
      .set({
        processedRows: 0,
        errorCount: errors.length,
        errorSummary: {
          reason: "error_rate_exceeded",
          applied: 0,
          sample: errors.slice(0, 50),
          totalErrors: errors.length,
          skipped: plan.skipped,
        },
        status: "failed",
        completedAt: new Date(),
      })
      .where(and(eq(t.id, uploadId), eq(t.status, "processing")));
    return;
  }

  // Phase 2: drop invoices a live PVS source already delivered.
  let alreadyViaPvs = 0;
  let entries = plan.entries;
  if (mapping.stream === "invoices") {
    const ids = entries.flatMap((e) =>
      "pvsInvoiceId" in e.event ? [e.event.pvsInvoiceId] : []
    );
    const live = await findLiveSourceInvoiceIds(upload.clinicId, ids);
    if (live.size > 0) {
      entries = entries.filter((e) => {
        const dup = "pvsInvoiceId" in e.event && live.has(e.event.pvsInvoiceId);
        if (dup) alreadyViaPvs += 1;
        return !dup;
      });
    }
  }

  // Phase 3: apply.
  let applied = 0;
  let processed = 0;
  const FLUSH_EVERY = 100;
  for (const entry of entries) {
    try {
      const res = await applyPvsEvent(entry.event);
      if (!res.ok) {
        errors.push({ row: entry.row, reason: `apply_failed: ${res.reason}` });
      } else {
        applied += 1;
      }
    } catch (err) {
      errors.push({
        row: entry.row,
        reason: `apply_threw: ${(err as Error).message}`,
      });
    }
    processed += 1;
    if (processed % FLUSH_EVERY === 0) {
      await db
        .update(schema.pvsCsvUploads)
        .set({
          processedRows: processed,
          errorCount: errors.length,
          // Heartbeat: a run that makes progress never looks dead.
          claimedAt: sql`now()`,
        })
        .where(eq(schema.pvsCsvUploads.id, uploadId));
    }
  }

  await db
    .update(schema.pvsCsvUploads)
    .set({
      processedRows: rows.length,
      errorCount: errors.length,
      errorSummary: {
        sample: errors.slice(0, 50),
        totalErrors: errors.length,
        applied,
        alreadyViaPvs,
        skipped: plan.skipped,
      },
      status: "completed",
      completedAt: new Date(),
    })
    .where(and(eq(t.id, uploadId), eq(t.status, "processing")));
}

/**
 * Cron catch-up (C8): confirmed uploads nobody holds a live claim on, i.e.
 * never picked up (inline run lost) or whose runner died. Oldest first,
 * archived Praxen skipped. Stops starting new files after `budgetMs`; a file
 * that outlives the function anyway leaves a claim that goes stale and is
 * retried next run until CSV_INGEST_MAX_ATTEMPTS.
 */
export async function catchUpPvsCsvIngest(
  opts: { limit?: number; budgetMs?: number } = {}
): Promise<Record<string, number>> {
  const { limit = 20, budgetMs = 120_000 } = opts;
  const started = Date.now();
  const due = await db
    .select({ id: t.id })
    .from(t)
    .innerJoin(schema.clinics, eq(schema.clinics.id, t.clinicId))
    .where(
      and(eq(t.status, "processing"), isNull(schema.clinics.archivedAt), claimFree())
    )
    .orderBy(asc(t.createdAt))
    .limit(limit);
  const outcomes: Record<string, number> = { due: due.length };
  for (const { id } of due) {
    let key: string;
    if (Date.now() - started > budgetMs) {
      key = "deferred";
    } else {
      try {
        key = await runPvsCsvIngest(id);
      } catch {
        key = "error"; // logged in runPvsCsvIngest, claim released
      }
    }
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  return outcomes;
}

/**
 * pvsInvoiceIds of this Praxis that a source OTHER than csv_upload already
 * recorded as InvoicePaid / InvoiceRefunded. Revenue is keyed
 * bridgeSource::pvsInvoiceId, so counting them again would double the
 * revenue and fire the ads conversion twice.
 */
export async function findLiveSourceInvoiceIds(
  clinicId: string,
  invoiceIds: string[]
): Promise<Set<string>> {
  const found = new Set<string>();
  const unique = [...new Set(invoiceIds)];
  const invoiceIdExpr = sql<string>`${schema.pvsEventLog.payload}->>'pvsInvoiceId'`;
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const hits = await db
      .selectDistinct({ id: invoiceIdExpr })
      .from(schema.pvsEventLog)
      .where(
        and(
          eq(schema.pvsEventLog.clinicId, clinicId),
          inArray(schema.pvsEventLog.kind, ["InvoicePaid", "InvoiceRefunded"]),
          ne(schema.pvsEventLog.bridgeSource, "csv_upload"),
          inArray(invoiceIdExpr, chunk)
        )
      );
    for (const h of hits) if (h.id) found.add(h.id);
  }
  return found;
}

async function fail(
  uploadId: string,
  errorSummary: Record<string, unknown>
): Promise<void> {
  await db
    .update(schema.pvsCsvUploads)
    .set({
      status: "failed",
      errorSummary,
      completedAt: new Date(),
    })
    .where(and(eq(t.id, uploadId), eq(t.status, "processing")));
}
