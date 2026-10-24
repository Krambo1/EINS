import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { getAdminSession } from "@/auth/admin";
import { getSession } from "@/auth/session";
import { hasR2 } from "@/lib/env";
import { VIDEO_KEY_PREFIX } from "@/lib/outreach-video";
import { CLONE_DOCUMENT_KEY_PATTERN } from "@/lib/clone-record";
import {
  GENERAL_UPLOAD_EXTENSIONS,
  MAX_VIDEO_UPLOAD_BYTES,
  fileExtension,
  uploadLimitForExtension,
} from "@/lib/uploads";

/**
 * Dev-only direct-upload sink — the local-driver counterpart of an R2
 * presigned PUT. The client POSTs raw file bytes here when
 * `createUploadTarget` returned mode "direct" (i.e. STORAGE_DRIVER=local).
 *
 * Security model mirrors /api/files:
 *   • Session required.
 *   • Key must carry the caller's clinic-id prefix — no cross-tenant writes.
 *   • Extension allowlist (general uploads + checklist profiles).
 *   • Byte cap enforced WHILE streaming, not after.
 *   • Path traversal + symlink containment via resolved-path prefix check.
 *
 * Answers 404 whenever R2 is configured AND always in production: a
 * production deploy without R2 must fail visibly (config error in the logs
 * and /api/health `config.storage:false`), not write patient files to the
 * ephemeral function disk (B-29).
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage");

/** `<clinicId>/assets/<uuid>.<ext>`, the key createUploadTarget mints for scope "assets". */
const ADMIN_ASSET_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/assets\/[0-9a-f-]{36}\.[a-z0-9]{1,8}$/;

// Checklist upload profiles allow a few extensions beyond the general list.
const EXTRA_ALLOWED = ["svg", "eps", "ai"];
const ALLOWED_EXTENSIONS = new Set([
  ...GENERAL_UPLOAD_EXTENSIONS,
  ...EXTRA_ALLOWED,
]);

export async function POST(req: NextRequest) {
  if (hasR2() || process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  if (key.startsWith(VIDEO_KEY_PREFIX)) {
    // Outreach videos (admin upload, server/outreach-videos.ts) are EINS-owned,
    // not clinic-scoped: an admin session instead of the clinic-prefix rule.
    if (!(await getAdminSession())) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  } else if (ADMIN_ASSET_KEY.test(key) && (await getAdminSession())) {
    // Post files EINS uploads for a Praxis (admin tab "Beiträge",
    // server/content.ts): clinic-scoped key, written by an admin session.
  } else if (CLONE_DOCUMENT_KEY_PATTERN.test(key) && (await getAdminSession())) {
    // KI-Klon consent and training opt-out (admin tab "KI-Klon",
    // server/clone.ts): `klon/<clinicId>/…`, outside the Praxis prefix, so
    // only an admin session writes it and the Praxis file route never serves it.
  } else {
    const session = await getSession();
    if (!session) return new NextResponse("Unauthorized", { status: 401 });
    if (!key.startsWith(`${session.clinicId}/`)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }
  const ext = fileExtension(key);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return new NextResponse("Unsupported file type", { status: 415 });
  }

  const full = join(STORAGE_ROOT, key);
  // Containment: the joined path must stay under STORAGE_ROOT.
  const resolved = resolve(full);
  if (resolved !== STORAGE_ROOT && !resolved.startsWith(STORAGE_ROOT + sep)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = req.body;
  if (!body) return new NextResponse("Empty body", { status: 400 });

  const cap = Math.min(uploadLimitForExtension(ext), MAX_VIDEO_UPLOAD_BYTES);
  await mkdir(dirname(resolved), { recursive: true });

  let written = 0;
  try {
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const nodeStream = Readable.fromWeb(
        body as import("node:stream/web").ReadableStream
      );
      const out = createWriteStream(resolved);
      nodeStream.on("data", (chunk: Buffer) => {
        written += chunk.length;
        if (written > cap) {
          nodeStream.destroy();
          out.destroy();
          rejectPromise(new Error("too_large"));
        }
      });
      nodeStream.on("error", rejectPromise);
      out.on("error", rejectPromise);
      out.on("finish", resolvePromise);
      nodeStream.pipe(out);
    });
  } catch (err) {
    // Remove the partial object — finalize would otherwise see it as valid.
    try {
      await unlink(resolved);
    } catch {
      // best effort
    }
    if (err instanceof Error && err.message === "too_large") {
      return new NextResponse("Payload Too Large", { status: 413 });
    }
    return new NextResponse("Upload failed", { status: 500 });
  }

  if (written === 0) {
    try {
      await unlink(resolved);
    } catch {
      // best effort
    }
    return new NextResponse("Empty body", { status: 400 });
  }

  return NextResponse.json({ ok: true, size: written });
}
