"use server";

import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { db, schema } from "@/db/client";
import { getStorage } from "@/server/storage";
import { writeAudit } from "@/server/audit";
import { enqueuePvsCsvIngest } from "@/server/jobs";
import {
  CsvMappingSchema,
  type CsvMapping,
  type CsvStream,
} from "@/server/pvs-csv-mapper";
import { requireSession } from "@/auth/guards";

/**
 * Server actions backing the CSV-upload wizard.
 *
 * Flow:
 *   step1) uploadCsv(formData)      → returns { uploadId, headers, previewRows }
 *   step2) confirmCsvMapping(...)   → persists mapping_json + enqueues worker
 *   step3) the worker fans out applyPvsEvent in-process
 *
 * The wizard UI calls these via React server-action invocation. Each
 * step writes an audit_log row.
 */

const PREVIEW_ROWS_LIMIT = 5;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

export interface UploadResult {
  ok: boolean;
  uploadId?: string;
  storageKey?: string;
  headers?: string[];
  previewRows?: Record<string, string>[];
  totalRows?: number;
  error?: string;
}

/**
 * Step 1: receive the file, persist to storage, parse headers + first 5 rows
 * for the mapping UI. Does NOT enqueue the worker — that happens in step 2
 * once the inhaber confirms the column → canonical-field mapping.
 */
export async function uploadCsv(formData: FormData): Promise<UploadResult> {
  const session = await requireSession();

  const file = formData.get("file");
  const streamRaw = formData.get("stream");
  const uploadGroupId = (formData.get("uploadGroupId") as string) || null;

  if (!(file instanceof File)) {
    return { ok: false, error: "no_file" };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: `file_too_large: ${(file.size / 1024 / 1024).toFixed(1)}MB, max 50MB`,
    };
  }
  const stream = parseStreamArg(streamRaw);
  if (!stream) return { ok: false, error: "invalid_stream" };

  const buffer = Buffer.from(await file.arrayBuffer());
  // Stream-detection: parse with auto-detected delimiter, BOM-aware,
  // tolerate trailing/empty lines.
  let parsed: Record<string, string>[];
  try {
    parsed = parseCsv(buffer, {
      bom: true,
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_quotes: true,
      relax_column_count: true,
    }) as Record<string, string>[];
  } catch (err) {
    return {
      ok: false,
      error: `csv_parse_error: ${(err as Error).message}`,
    };
  }
  if (parsed.length === 0) return { ok: false, error: "csv_empty" };

  const headers = Object.keys(parsed[0]!);
  const previewRows = parsed.slice(0, PREVIEW_ROWS_LIMIT);
  const totalRows = parsed.length;

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
  };
}

/**
 * Step 2: receive the column-mapping JSON from the wizard, validate it,
 * and enqueue the worker.
 */
export async function confirmCsvMapping(input: {
  uploadId: string;
  mapping: CsvMapping;
}): Promise<{ ok: boolean; error?: string }> {
  const session = await requireSession();
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

  await db
    .update(schema.pvsCsvUploads)
    .set({
      mappingJson: parsed.data as unknown as Record<string, unknown>,
      status: "processing",
      startedAt: new Date(),
    })
    .where(eq(schema.pvsCsvUploads.id, row.id));

  await enqueuePvsCsvIngest(row.id);

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
} | null> {
  const session = await requireSession();
  const [row] = await db
    .select({
      id: schema.pvsCsvUploads.id,
      status: schema.pvsCsvUploads.status,
      totalRows: schema.pvsCsvUploads.totalRows,
      processedRows: schema.pvsCsvUploads.processedRows,
      errorCount: schema.pvsCsvUploads.errorCount,
      errorSummary: schema.pvsCsvUploads.errorSummary,
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
  return { ok: true, ...row };
}

export async function listRecentCsvUploads(limit = 20) {
  const session = await requireSession();
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
    .limit(limit);
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
