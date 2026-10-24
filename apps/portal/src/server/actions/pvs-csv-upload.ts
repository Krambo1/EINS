"use server";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { db, schema } from "@/db/client";
import { getStorage } from "@/server/storage";
import { writeAudit } from "@/server/audit";
import { runPvsCsvIngest } from "@/worker/processors/pvs-csv-ingest";
import { describeErrorForLog } from "@/lib/error-log";
import {
  CsvMappingSchema,
  type CsvMapping,
  type CsvStream,
} from "@/server/pvs-csv-mapper";
import { requireSession } from "@/auth/guards";
import { can } from "@/lib/roles";
import { z } from "zod";
import { CsvParseError, parseCsvBuffer } from "@/server/pvs-csv-parse";

/**
 * Server actions backing the CSV-upload wizard.
 *
 * Flow:
 *   step1) uploadCsv(formData)      → returns { uploadId, headers, previewRows }
 *   step2) confirmCsvMapping(...)   → persists mapping_json, status 'processing'
 *   step3) runPvsCsvIngest fans out applyPvsEvent in-process, started inline
 *          via after() (C8: production runs without the pg-boss worker);
 *          /api/cron/daily + /api/cron/morning catch up a lost or timed-out
 *          run. An atomic claim on the row keeps the file from being
 *          processed twice.
 *
 * The wizard UI calls these via React server-action invocation. Each
 * step writes an audit_log row.
 */

const PREVIEW_ROWS_LIMIT = 5;
/**
 * B-21: the file travels in the server-action request body. Vercel Functions
 * accept about 4.5 MB per request (Next's 10 MB bodySizeLimit never applies
 * before that), so 4 MB is the real ceiling incl. multipart overhead. The
 * wizard states the same limit.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
/** A confirmed upload still "processing" after this long is shown as stalled. */
const STALLED_AFTER_MS = 15 * 60 * 1000;

const UuidSchema = z.string().uuid();

/**
 * B-18: CSV imports change revenue and treatment data (the basis for the
 * Auswertung), so every action requires `settings.integrations` (Inhaber),
 * like the other integration surfaces. Returns null when not allowed.
 */
async function requireIntegrationsSession() {
  const session = await requireSession();
  return can(session.role, "settings.integrations") ? session : null;
}

export interface UploadResult {
  ok: boolean;
  uploadId?: string;
  storageKey?: string;
  headers?: string[];
  previewRows?: Record<string, string>[];
  totalRows?: number;
  /** Detection results, shown to the user in the wizard. */
  delimiter?: string;
  encoding?: string;
  headerRowNumber?: number;
  skippedPreambleLines?: number;
  skippedFooterLines?: number;
  error?: string;
}

/**
 * Step 1: receive the file, persist to storage, parse headers + first 5 rows
 * for the mapping UI. Does NOT enqueue the worker — that happens in step 2
 * once the inhaber confirms the column → canonical-field mapping.
 */
export async function uploadCsv(formData: FormData): Promise<UploadResult> {
  const session = await requireIntegrationsSession();
  if (!session) return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  const streamRaw = formData.get("stream");
  const uploadGroupRaw = formData.get("uploadGroupId");
  let uploadGroupId: string | null = null;
  if (typeof uploadGroupRaw === "string" && uploadGroupRaw.length > 0) {
    const parsedGroup = UuidSchema.safeParse(uploadGroupRaw);
    if (!parsedGroup.success) return { ok: false, error: "invalid_upload_group" };
    uploadGroupId = parsedGroup.data;
  }

  if (!(file instanceof File)) {
    return { ok: false, error: "no_file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "file_too_large" };
  }
  const stream = parseStreamArg(streamRaw);
  if (!stream) return { ok: false, error: "invalid_stream" };

  const buffer = Buffer.from(await file.arrayBuffer());
  // Encoding, delimiter, header row and footer lines are detected in the
  // shared parser, so the preview matches what the worker will ingest.
  let csv: ReturnType<typeof parseCsvBuffer>;
  try {
    csv = parseCsvBuffer(buffer);
  } catch (err) {
    if (err instanceof CsvParseError) return { ok: false, error: err.message };
    return { ok: false, error: `csv_parse_error: ${(err as Error).message}` };
  }
  if (csv.rows.length === 0) return { ok: false, error: "csv_empty" };

  const headers = csv.headers;
  const previewRows = csv.rows.slice(0, PREVIEW_ROWS_LIMIT);
  const totalRows = csv.rows.length;

  // Persist the raw bytes to storage. Key includes the clinic id so the
  // worker can derive it back without a DB lookup for sanity-check logging.
  const storageKey = `pvs-csv-uploads/${session.clinicId}/${randomUUID()}.csv`;
  await getStorage().put(storageKey, buffer, { contentType: "text/csv" });

  // Insert a "pending" upload row. mapping_json is empty for now — step 2
  // overwrites it once the inhaber confirms.
  const [row] = await db
    .insert(schema.pvsCsvUploads)
    .values({
      clinicId: session.clinicId,
      storageKey,
      originalFilename: file.name,
      stream,
      mappingJson: {},
      status: "pending",
      totalRows,
      uploadGroupId: uploadGroupId ?? null,
      createdBy: session.userId,
    })
    .returning({ id: schema.pvsCsvUploads.id });

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_csv_upload",
    entityKind: "pvs_csv_uploads",
    entityId: row!.id,
    diff: { filename: file.name, stream, totalRows },
  });

  return {
    ok: true,
    uploadId: row!.id,
    storageKey,
    headers,
    previewRows,
    totalRows,
    delimiter: csv.delimiter,
    encoding: csv.encoding,
    headerRowNumber: csv.headerRowNumber,
    skippedPreambleLines: csv.skippedPreambleLines,
    skippedFooterLines: csv.skippedFooterLines,
  };
}

/**
 * Step 2: receive the column-mapping JSON from the wizard, validate it,
 * and start processing right after the response (after()).
 */
export async function confirmCsvMapping(input: {
  uploadId: string;
  mapping: CsvMapping;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireIntegrationsSession();
  if (!session) return { ok: false, error: "forbidden" };
  if (!UuidSchema.safeParse(input?.uploadId).success) {
    return { ok: false, error: "upload_not_found" };
  }
  const parsed = CsvMappingSchema.safeParse(input.mapping);
  if (!parsed.success) {
    return { ok: false, error: "invalid_mapping" };
  }

  const [row] = await db
    .select({
      id: schema.pvsCsvUploads.id,
      clinicId: schema.pvsCsvUploads.clinicId,
      status: schema.pvsCsvUploads.status,
      stream: schema.pvsCsvUploads.stream,
    })
    .from(schema.pvsCsvUploads)
    .where(
      and(
        eq(schema.pvsCsvUploads.id, input.uploadId),
        eq(schema.pvsCsvUploads.clinicId, session.clinicId)
      )
    )
    .limit(1);

  if (!row) return { ok: false, error: "upload_not_found" };
  if (row.status !== "pending") {
    return {
      ok: false,
      error: `upload_already_${row.status}`,
    };
  }
  if (row.stream !== parsed.data.stream) {
    return { ok: false, error: "stream_mismatch" };
  }
  // Without a status column every row would be booked as paid revenue; the
  // user must have confirmed that explicitly.
  if (
    parsed.data.stream === "invoices" &&
    !parsed.data.columns.statusColumn &&
    !parsed.data.allRowsPaidConfirmed
  ) {
    return { ok: false, error: "status_confirmation_required" };
  }

  // Only a still-pending row moves on, so a double submit confirms once.
  const confirmed = await db
    .update(schema.pvsCsvUploads)
    .set({
      mappingJson: parsed.data as unknown as Record<string, unknown>,
      status: "processing",
      startedAt: new Date(),
    })
    .where(
      and(
        eq(schema.pvsCsvUploads.id, row.id),
        eq(schema.pvsCsvUploads.status, "pending")
      )
    )
    .returning({ id: schema.pvsCsvUploads.id });
  if (confirmed.length === 0) {
    return { ok: false, error: "upload_already_processing" };
  }

  await writeAudit({
    clinicId: session.clinicId,
    actorId: session.userId,
    action: "pvs_csv_mapping_confirmed",
    entityKind: "pvs_csv_uploads",
    entityId: row.id,
    diff: { stream: parsed.data.stream },
  });

  // Ensure the clinic has a pvs_link row marking csv_upload as the active
  // adapter (if no other adapter is configured). This unlocks the
  // applyPvsEvent path which checks link.status.
  await ensureCsvLink(session.clinicId);

  // C8: process now, without the worker. Runs after the response inside this
  // function's time limit; if it dies there, the claim goes stale and the
  // cron catch-up retries it. Same `db` handle as the worker and the cron.
  const uploadId = row.id;
  after(async () => {
    try {
      await runPvsCsvIngest(uploadId);
    } catch (err) {
      console.error(
        JSON.stringify({
          scope: "pvs-csv-upload",
          uploadId,
          error: describeErrorForLog(err),
        })
      );
    }
  });

  return { ok: true };
}

/**
 * Read upload progress for the UI polling loop. Returns a small JSON shape
 * the wizard renders into the progress bar / errors panel.
 */
export async function getCsvUploadStatus(uploadId: string): Promise<{
  ok: boolean;
  status?: string;
  totalRows?: number | null;
  processedRows?: number;
  errorCount?: number;
  errorSummary?: unknown;
  /** B-21: confirmed upload still "processing" after 15 min (run died, cron retries). */
  stalled?: boolean;
} | null> {
  const session = await requireIntegrationsSession();
  if (!session) return null;
  if (!UuidSchema.safeParse(uploadId).success) return null;
  const [row] = await db
    .select({
      id: schema.pvsCsvUploads.id,
      status: schema.pvsCsvUploads.status,
      totalRows: schema.pvsCsvUploads.totalRows,
      processedRows: schema.pvsCsvUploads.processedRows,
      errorCount: schema.pvsCsvUploads.errorCount,
      errorSummary: schema.pvsCsvUploads.errorSummary,
      startedAt: schema.pvsCsvUploads.startedAt,
    })
    .from(schema.pvsCsvUploads)
    .where(
      and(
        eq(schema.pvsCsvUploads.id, uploadId),
        eq(schema.pvsCsvUploads.clinicId, session.clinicId)
      )
    )
    .limit(1);
  if (!row) return null;
  const { startedAt, ...rest } = row;
  const stalled =
    row.status === "processing" &&
    startedAt !== null &&
    Date.now() - startedAt.getTime() > STALLED_AFTER_MS;
  return { ok: true, ...rest, stalled };
}

export async function listRecentCsvUploads(limit = 20) {
  const session = await requireIntegrationsSession();
  if (!session) return [];
  const safeLimit = Math.min(Math.max(1, Math.trunc(Number(limit) || 20)), 50);
  return await db
    .select({
      id: schema.pvsCsvUploads.id,
      originalFilename: schema.pvsCsvUploads.originalFilename,
      stream: schema.pvsCsvUploads.stream,
      status: schema.pvsCsvUploads.status,
      totalRows: schema.pvsCsvUploads.totalRows,
      processedRows: schema.pvsCsvUploads.processedRows,
      errorCount: schema.pvsCsvUploads.errorCount,
      createdAt: schema.pvsCsvUploads.createdAt,
      completedAt: schema.pvsCsvUploads.completedAt,
    })
    .from(schema.pvsCsvUploads)
    .where(eq(schema.pvsCsvUploads.clinicId, session.clinicId))
    .orderBy(desc(schema.pvsCsvUploads.createdAt))
    .limit(safeLimit);
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function parseStreamArg(input: FormDataEntryValue | null): CsvStream | null {
  const v = typeof input === "string" ? input : "";
  if (
    v === "patients" ||
    v === "appointments" ||
    v === "encounters" ||
    v === "invoices"
  ) {
    return v;
  }
  return null;
}

async function ensureCsvLink(clinicId: string): Promise<void> {
  const [existing] = await db
    .select({
      id: schema.pvsLink.id,
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, clinicId))
    .limit(1);

  if (!existing) {
    await db.insert(schema.pvsLink).values({
      clinicId,
      pvsVendor: "csv_upload",
      status: "connected",
      connectionConfig: {},
    });
    return;
  }
  // If they're on a real adapter (tomedo, healthhub, etc.) and CSV-upload is
  // a one-off, leave their vendor alone — multi-source ingestion is fine.
  // Only flip to csv_upload status if they're currently unconfigured.
  if (existing.status === "unconfigured") {
    await db
      .update(schema.pvsLink)
      .set({
        pvsVendor: "csv_upload",
        status: "connected",
        updatedAt: new Date(),
      })
      .where(eq(schema.pvsLink.id, existing.id));
  }
}
