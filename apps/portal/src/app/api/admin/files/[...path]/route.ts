import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { getAdminSession } from "@/auth/admin";
import { getStorage } from "@/server/storage";
import { hasR2 } from "@/lib/env";

/**
 * Admin-scoped file passthrough. Admins are cross-tenant by design, so unlike
 * the clinic `/api/files` route this does NOT enforce a clinic-id prefix — the
 * admin session itself is the authorization. Used by the admin checklist tab to
 * download client-uploaded assets.
 *
 *   • Requires a valid admin session (redirects to /admin/login otherwise).
 *   • Local driver: streams the file from storage/<key> with path-traversal
 *     and symlink containment, same as the clinic route.
 *   • R2 driver: redirects to a short-lived signed URL.
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getAdminSession();
  if (!session) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const { path: segments } = await params;
  const key = segments.join("/");

  if (key.includes("..") || key.startsWith("/")) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // R2: hand off to a signed URL; the SDK is only loaded on that path.
  if (hasR2()) {
    const url = await getStorage().urlFor(key, { expiresInSeconds: 300 });
    return NextResponse.redirect(url);
  }

  const full = join(STORAGE_ROOT, key);
  try {
    const real = await realpath(full);
    const rootReal = await realpath(STORAGE_ROOT);
    if (real !== rootReal && !real.startsWith(rootReal + sep)) {
      return new NextResponse("Forbidden", { status: 403 });
    }
    const stats = await stat(real);
    if (!stats.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }
    const stream = createReadStream(real);
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(real),
        "Content-Length": String(stats.size),
        "Cache-Control": "private, max-age=60",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".eps") || lower.endsWith(".ai")) {
    return "application/postscript";
  }
  if (lower.endsWith(".heic") || lower.endsWith(".heif")) return "image/heif";
  return "application/octet-stream";
}
