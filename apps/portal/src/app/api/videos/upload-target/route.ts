import { NextResponse, type NextRequest } from "next/server";
import { checkVideoApiToken, createVideoUploadTarget } from "@/server/outreach-videos";

/**
 * POST /api/videos/upload-target   (Bearer VIDEO_API_TOKEN)
 *   { kind: "video" | "poster", filename, size, contentType? }
 *   → { key, url, contentType }
 *
 * PUT the file to `url` with exactly that Content-Type, then POST /api/videos
 * with the key. Same two-step flow the admin page uses.
 */
export async function POST(request: NextRequest) {
  const check = checkVideoApiToken(request.headers.get("authorization"));
  if (check === "disabled") {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  if (check !== "ok") {
    return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
  }
  const result = await createVideoUploadTarget(
    body as Parameters<typeof createVideoUploadTarget>[0]
  );
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error } }, { status: 400 });
  }
  return NextResponse.json(result.data);
}
