"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSession } from "@/auth/guards";
import { db, schema, withClinicContext } from "@/db/client";
import { writeAudit } from "@/server/audit";
import { getStorage } from "@/server/storage";
import { getEmailSender, renderEmailLayout } from "@/server/email";
import { can, ForbiddenError } from "@/lib/roles";
import {
  GENERAL_UPLOAD_EXTENSIONS,
  fileExtension,
  uploadLimitForExtension,
} from "@/lib/uploads";
import {
  createUploadTarget,
  verifyUploadedObject,
  type UploadTarget,
} from "@/server/uploads";

/**
 * "Dateien an EINS" — general clinic-to-EINS file delivery.
 *
 * Three-step flow (see server/uploads.ts for why bytes never transit a
 * server action):
 *   1. createClientUploadTargetsAction — validate + mint storage targets.
 *   2. Browser uploads each file directly to its target (upload-client.ts).
 *   3. finalizeClientUploadsAction — verify the objects landed, write DB
 *      rows, audit, notify EINS by email.
 */

const MAX_FILES_PER_BATCH = 20;
const MAX_NOTE_LENGTH = 2000;

export type UploadActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

// ---------------------------------------------------------------
// Step 1 — mint targets
// ---------------------------------------------------------------

const TargetsInput = z.object({
  files: z
    .array(
      z.object({
        name: z.string().min(1).max(300),
        size: z.number().int().positive(),
        type: z.string().max(200),
      })
    )
    .min(1)
    .max(MAX_FILES_PER_BATCH),
});

export interface MintedTarget extends UploadTarget {
  /** Echo of the client filename, so the browser can pair file ↔ target. */
  name: string;
}

export async function createClientUploadTargetsAction(
  input: z.infer<typeof TargetsInput>
): Promise<UploadActionResult<{ targets: MintedTarget[] }>> {
  const session = await requireSession();
  if (!can(session.role, "uploads.send")) {
    throw new ForbiddenError("uploads.send");
  }
  const parsed = TargetsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  for (const f of parsed.data.files) {
    const ext = fileExtension(f.name);
    if (!GENERAL_UPLOAD_EXTENSIONS.includes(ext)) {
      return { ok: false, error: `bad_type:${f.name}` };
    }
    if (f.size > uploadLimitForExtension(ext)) {
      return { ok: false, error: `too_large:${f.name}` };
    }
  }

  const targets: MintedTarget[] = [];
  for (const f of parsed.data.files) {
    const target = await createUploadTarget({
      clinicId: session.clinicId,
      scope: "uploads",
      extension: fileExtension(f.name),
      contentType: f.type,
    });
    targets.push({ ...target, name: f.name });
  }
  return { ok: true, data: { targets } };
}

// ---------------------------------------------------------------
// Step 3 — finalize the batch
// ---------------------------------------------------------------

const FinalizeInput = z.object({
  files: z
    .array(
      z.object({
        key: z.string().min(1).max(500),
        name: z.string().min(1).max(300),
        type: z.string().max(200).optional(),
      })
    )
    .min(1)
    .max(MAX_FILES_PER_BATCH),
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});

export async function finalizeClientUploadsAction(
  input: z.infer<typeof FinalizeInput>
): Promise<UploadActionResult<{ saved: number; failed: string[] }>> {
  const session = await requireSession();
  if (!can(session.role, "uploads.send")) {
    throw new ForbiddenError("uploads.send");
  }
  const parsed = FinalizeInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const note = parsed.data.note?.trim() ? parsed.data.note.trim() : null;
  const prefix = `${session.clinicId}/uploads/`;
  const saved: { name: string; size: number }[] = [];
  const failed: string[] = [];

  for (const f of parsed.data.files) {
    // A client can only finalize keys inside its own uploads namespace, and
    // only ones that actually hold bytes.
    if (!f.key.startsWith(prefix) || f.key.includes("..")) {
      failed.push(f.name);
      continue;
    }
    const head = await verifyUploadedObject(f.key);
    if (!head) {
      failed.push(f.name);
      continue;
    }
    await withClinicContext(session.clinicId, session.userId, async (tx) => {
      await tx
        .insert(schema.clientUploads)
        .values({
          clinicId: session.clinicId,
          storageKey: f.key,
          originalFilename: f.name.slice(0, 300),
          contentType: head.contentType ?? f.type ?? null,
          sizeBytes: head.size,
          note,
          uploadedBy: session.userId,
        })
        // Double-finalize of the same key (retry, double-click) is a no-op.
        .onConflictDoNothing({ target: schema.clientUploads.storageKey });
    });
    saved.push({ name: f.name, size: head.size });
  }

  if (saved.length > 0) {
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "upload",
      entityKind: "client_upload",
      diff: { files: saved.map((s) => s.name), note },
    });
    await notifyEins(session, saved, note);
    revalidatePath("/dateien");
  }

  return { ok: true, data: { saved: saved.length, failed } };
}

// ---------------------------------------------------------------
// Delete an own delivery
// ---------------------------------------------------------------

export async function deleteClientUploadAction(
  formData: FormData
): Promise<void> {
  const session = await requireSession();
  if (!can(session.role, "uploads.send")) {
    throw new ForbiddenError("uploads.send");
  }
  const id = z.string().uuid().safeParse(formData.get("id"));
  if (!id.success) return;

  let storageKey: string | null = null;
  let filename: string | null = null;
  await withClinicContext(session.clinicId, session.userId, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.clientUploads)
      .where(
        and(
          eq(schema.clientUploads.id, id.data),
          eq(schema.clientUploads.clinicId, session.clinicId)
        )
      )
      .limit(1);
    if (!row) return;
    storageKey = row.storageKey;
    filename = row.originalFilename;
    await tx
      .delete(schema.clientUploads)
      .where(eq(schema.clientUploads.id, row.id));
  });

  if (storageKey) {
    await getStorage().remove(storageKey);
    await writeAudit({
      clinicId: session.clinicId,
      actorId: session.userId,
      actorEmail: session.email,
      action: "delete",
      entityKind: "client_upload",
      entityId: id.data,
      diff: { filename },
    });
  }

  revalidatePath("/dateien");
}

// ---------------------------------------------------------------
// EINS notification — best effort, never blocks the delivery
// ---------------------------------------------------------------

async function notifyEins(
  session: { clinicId: string; email: string },
  saved: { name: string; size: number }[],
  note: string | null
): Promise<void> {
  try {
    const [clinic] = await db
      .select({ displayName: schema.clinics.displayName })
      .from(schema.clinics)
      .where(eq(schema.clinics.id, session.clinicId))
      .limit(1);
    const clinicLabel = clinic?.displayName ?? session.clinicId;
    const subject = `EINS · ${saved.length} ${
      saved.length === 1 ? "neue Datei" : "neue Dateien"
    } von ${clinicLabel}`;

    const fileLines = saved.map((s) => `• ${s.name} (${formatBytes(s.size)})`);
    const text = [
      subject,
      "",
      `Praxis:  ${clinicLabel}`,
      `Nutzer:  ${session.email}`,
      "",
      ...fileLines,
      "",
      `Notiz: ${note ?? "(keine)"}`,
      "",
      "Abrufbar im Admin unter Praxen → Dateien.",
    ].join("\n");

    const esc = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const fileListHtml = `<ul style="margin:0 0 24px 0; padding-left:20px; color:#10101a; font-size:15px; line-height:1.7;">${saved
      .map((s) => `<li>${esc(s.name)} <span style="color:#6a6a74;">(${formatBytes(s.size)})</span></li>`)
      .join("")}</ul>`;
    const noteBlock = note
      ? `<blockquote style="margin:0 0 32px 0; padding:18px 20px; background:#f5f5f7; border-left:3px solid #58BAB5; border-radius:0 8px 8px 0; color:#10101a; font-size:15px; line-height:1.55;">${esc(note).replace(/\n/g, "<br>")}</blockquote>`
      : "";
    const html = renderEmailLayout({
      preheader: `${clinicLabel} hat ${saved.length} ${saved.length === 1 ? "Datei" : "Dateien"} hochgeladen.`,
      heading: `Neue Dateien von ${clinicLabel}`,
      introHtml: `<p style="font-size:16px; line-height:1.55; color:#4a4a52; margin:0 0 20px 0;">Die Praxis hat Dateien über das Portal geliefert:</p>`,
      customBlockHtml: fileListHtml + noteBlock,
      auditRows: [
        { label: "Praxis", value: clinicLabel },
        { label: "Nutzer", value: session.email },
        { label: "Dateien", value: String(saved.length) },
      ],
      footerLines: [
        "Interne Benachrichtigung · EINS Portal",
        "Diese E-Mail wurde automatisch versendet. Bitte antworten Sie nicht direkt.",
      ],
    });
    await getEmailSender().send({ to: "team@eins.ag", subject, text, html });
  } catch {
    // Swallow — the files are persisted; the admin tab is the fallback.
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
