import { eq } from "drizzle-orm";
import { parse as parseCsv } from "csv-parse/sync";
import { db, schema } from "@/db/client";
import { getStorage } from "@/server/storage";
import { applyPvsEvent } from "@/server/pvs-events";
import { mapCsvRow, CsvMappingSchema } from "@/server/pvs-csv-mapper";

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
 * Failure handling: each row that fails to map (missing required field,
 * invalid date, etc.) is logged into `error_summary` with the row index.
 * If >5% of rows fail, the upload is marked `failed`; otherwise `completed`
 * with the error summary attached for UI display.
 */

export interface PvsCsvIngestJob {
  uploadId: string;
}

const HARD_FAIL_RATIO = 0.05; // >5% errors → mark upload failed

export async function processPvsCsvIngest(
  job: PvsCsvIngestJob
): Promise<void> {
  const { uploadId } = job;

  const [upload] = await db
    .select({
      id: schema.pvsCsvUploads.id,
      clinicId: schema.pvsCsvUploads.clinicId,
      storageKey: schema.pvsCsvUploads.storageKey,
      stream: schema.pvsCsvUploads.stream,
      mappingJson: schema.pvsCsvUploads.mappingJson,
      status: schema.pvsCsvUploads.status,
    })
    .from(schema.pvsCsvUploads)
    .where(eq(schema.pvsCsvUploads.id, uploadId))
    .limit(1);
  if (!upload) {
    console.warn(`[pvs-csv-ingest] upload ${uploadId} not found — skipping`);
    return;
  }
  if (upload.status === "completed" || upload.status === "failed") {
    console.warn(
      `[pvs-csv-ingest] upload ${uploadId} already terminal (${upload.status}) — skipping`
    );
    return;
  }

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
    rows = parseCsv(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (err) {
    await fail(uploadId, { reason: "read_or_parse_failed", message: String(err) });
    return;
  }

  await db
    .update(schema.pvsCsvUploads)
    .set({
      totalRows: rows.length,
      startedAt: new Date(),
    })
    .where(eq(schema.pvsCsvUploads.id, uploadId));

  let processed = 0;
  let errors: Array<{ row: number; reason: string }> = [];
  const FLUSH_EVERY = 100;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const result = mapCsvRow({
      clinicId: upload.clinicId,
      uploadId: upload.id,
      rowIndex: i,
      row,
      mapping,
    });
    if (!result.ok) {
      errors.push({ row: i, reason: result.reason });
    } else {
      for (const event of result.events) {
        try {
          const applied = await applyPvsEvent(event);
          if (!applied.ok) {
            errors.push({
              row: i,
              reason: `apply_failed: ${applied.reason}`,
            });
          }
        } catch (err) {
          errors.push({ row: i, reason: `apply_threw: ${(err as Error).message}` });
        }
      }
    }
    processed += 1;
    if (processed % FLUSH_EVERY === 0) {
      await db
        .update(schema.pvsCsvUploads)
        .set({
          processedRows: processed,
          errorCount: errors.length,
        })
        .where(eq(schema.pvsCsvUploads.id, uploadId));
    }
  }

  const errorRatio = rows.length === 0 ? 0 : errors.length / rows.length;
  const finalStatus =
    errorRatio > HARD_FAIL_RATIO ? "failed" : "completed";

  await db
    .update(schema.pvsCsvUploads)
    .set({
      processedRows: processed,
      errorCount: errors.length,
      errorSummary: { sample: errors.slice(0, 50), totalErrors: errors.length },
      status: finalStatus,
      completedAt: new Date(),
    })
    .where(eq(schema.pvsCsvUploads.id, uploadId));
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
    .where(eq(schema.pvsCsvUploads.id, uploadId));
}
