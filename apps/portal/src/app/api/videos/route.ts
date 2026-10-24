import { NextResponse, type NextRequest } from "next/server";
import {
  checkVideoApiToken,
  createOutreachVideo,
  listOutreachVideoSessions,
  listOutreachVideos,
} from "@/server/outreach-videos";

/**
 * Token API for the outreach tooling (Claude skills, scripts). Auth is
 * `Authorization: Bearer <VIDEO_API_TOKEN>`; without a configured token the
 * route answers 404.
 *
 *   GET  /api/videos                 → every active video with its stats
 *   GET  /api/videos?archived=1      → including archived ones
 *   GET  /api/videos?slug=<slug>     → one video, plus every page load (sessions)
 *   POST /api/videos                 → create the page for an uploaded video
 *        { videoKey, posterKey?, praxisName, title?, message?, recipientEmail?,
 *          obsidianRef?, durationSeconds? }   (keys from /api/videos/upload-target)
 */

function gate(request: NextRequest): NextResponse | null {
  const check = checkVideoApiToken(request.headers.get("authorization"));
  if (check === "ok") return null;
  if (check === "disabled") {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  return NextResponse.json({ error: { code: "unauthorized" } }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const denied = gate(request);
  if (denied) return denied;

  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  if (slug) {
    const [video] = await listOutreachVideos({ slug, includeArchived: true });
    if (!video) {
      return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
    }
    const sessions = await listOutreachVideoSessions(video.id);
    return NextResponse.json({ video, sessions });
  }

  const videos = await listOutreachVideos({
    includeArchived: url.searchParams.get("archived") === "1",
  });
  return NextResponse.json({ videos });
}

export async function POST(request: NextRequest) {
  const denied = gate(request);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json" } }, { status: 400 });
  }
  const result = await createOutreachVideo(
    body as Parameters<typeof createOutreachVideo>[0],
    "api"
  );
  if (!result.ok) {
    return NextResponse.json({ error: { code: result.error } }, { status: 400 });
  }
  return NextResponse.json(result.data, { status: 201 });
}
