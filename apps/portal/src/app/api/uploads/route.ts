import { NextRequest, NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { getSession } from "@/auth/session";
import { hasR2 } from "@/lib/env";
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
 * In production with STORAGE_DRIVER=r2 this route is unused and returns 404
 * (uploads go straight to R2, bypassing the serverless body limit).
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage");

// Checklist upload profiles allow a few extensions beyond the general list.
const EXTRA_ALLOWED = ["svg", "eps", "ai"];
const ALLOWED_EXTENSIONS = new Set([
  ...GENERAL_UPLOAD_EXTENSIONS,
  ...EXTRA_ALLOWED,
]);

export async function POST(req: NextRequest) {
  if (hasR2()) return new NextResponse("Not Found", { status: 404 });

  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const key = req.nextUrl.searchParams.get("key") ?? "";
  if (!key || key.includes("..") || key.startsWith("/") || key.includes("\\")) {
    return new NextResponse("Bad Request", { status: 400 });
  }
  if (!key.startsWith(`${session.clinicId}/`)) {
    return new NextResponse("Forbidden", { status: 403 });
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
