import "server-only";
import { randomUUID } from "node:crypto";
import { getStorage } from "@/server/storage";

/**
 * Server-side helpers for the direct-to-storage upload flow.
 *
 * Why not just accept the bytes in a server action: Vercel serverless caps
 * request bodies at ~4.5 MB, so any real document, photo or video dies in
 * transit no matter what `bodySizeLimit` says. Instead the client asks for
 * an upload target, PUTs the file straight to object storage (R2 presigned
 * URL in prod, /api/uploads passthrough in local dev), then calls a
 * finalize action that verifies the object actually landed before any DB
 * row is written.
 */

export interface UploadTarget {
  /** Storage key the client must upload to (also the finalize handle). */
  key: string;
  /** "presigned" = PUT to `url` (R2). "direct" = POST to `url` (local dev). */
  mode: "presigned" | "direct";
  url: string;
}

/** Normalized content type — presign signature and client header must match. */
export function normalizeContentType(raw: string | undefined | null): string {
  const t = (raw ?? "").trim();
  return t.length > 0 && t.length <= 200 ? t : "application/octet-stream";
}

/**
 * Mint an un-guessable, clinic-scoped storage key and the matching upload
 * target. `scope` is the path segment between the clinic id and the file
 * uuid (e.g. "uploads" or "checklist/A1"); the caller has already validated
 * extension + size against its own allowlist.
 */
export async function createUploadTarget(opts: {
  clinicId: string;
  scope: string;
  extension: string;
  contentType: string | undefined | null;
}): Promise<UploadTarget> {
  const safeExt =
    opts.extension.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
  const key = `${opts.clinicId}/${opts.scope}/${randomUUID()}.${safeExt}`;
  const contentType = normalizeContentType(opts.contentType);

  const presigned = await getStorage().presignedPutUrl(key, {
    contentType,
    // Long enough for a 2 GB video on a slow Praxis uplink.
    expiresInSeconds: 3600,
  });
  if (presigned) {
    return { key, mode: "presigned", url: presigned };
  }
  return {
    key,
    mode: "direct",
    url: `/api/uploads?key=${encodeURIComponent(key)}`,
  };
}

/**
 * Confirm the object exists in storage and return its real size. Returns
 * null when the client claims a key it never uploaded to (or the upload
 * failed mid-flight). The head() size is the source of truth for the DB
 * row — never trust the client-declared size.
 */
export async function verifyUploadedObject(
  key: string
): Promise<{ size: number; contentType?: string } | null> {
  const head = await getStorage().head(key);
  if (!head || head.size <= 0) return null;
  return head;
}
