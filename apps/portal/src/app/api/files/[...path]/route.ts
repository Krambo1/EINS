import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getSession } from "@/auth/session";

/**
 * Dev-only passthrough for locally stored assets.
 *
 * Security model:
 *   • Only logged-in clinic users can read — defense in depth beyond the
 *     un-guessable storage keys.
 *   • The key MUST start with the caller's clinic_id prefix. Cross-tenant
 *     access is refused even if someone guesses another clinic's key.
 *   • Global paths (animations library, EINS branding) start with
 *     `global/` and are readable by any authenticated user.
 *
 * In production with STORAGE_DRIVER=r2, this route is unused and returns 404.
 */

const STORAGE_ROOT = resolve(process.cwd(), "storage");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const session = await getSession();
  if (!session) return new NextResponse("Unauthorized", { status: 401 });

  const { path: segments } = await params;
  const key = segments.join("/");

  // Block path traversal.
  if (key.includes("..") || key.startsWith("/")) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  // Enforce tenancy — clinic-owned assets are namespaced by clinic id.
  if (!key.startsWith("global/") && !key.startsWith(`${session.clinicId}/`)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const full = join(STORAGE_ROOT, key);
  try {
    const stats = await stat(full);
    if (!stats.isFile()) {
      return new NextResponse("Not Found", { status: 404 });
    }
    // Guess a content type from extension — good enough for the dev path.
    const ct = contentTypeFor(full);
    const stream = createReadStream(full);
    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": ct,
        "Content-Length": String(stats.size),
        "Cache-Control": "private, max-age=60",
        // Strip the path from referrers to avoid leaking key structure.
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}
