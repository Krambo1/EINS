import { NextResponse, type NextRequest } from "next/server";
import { getPublicVideo } from "@/server/outreach-videos";

/**
 * GET /api/public/videos/[slug]
 *
 * What the watch page on eins.ag/v/<slug> needs to render: Praxis name,
 * title, note, a playback URL and the poster. The website server calls this
 * on every page render; the slug is the only credential (10 random chars,
 * not enumerable) and the answer carries nothing the page itself does not
 * show. Archived or unknown slugs are a plain 404.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  const video = await getPublicVideo(slug);
  if (!video) {
    return NextResponse.json(
      { error: { code: "not_found" } },
      { status: 404, headers: { "Cache-Control": "no-store" } }
    );
  }
  return NextResponse.json(video, {
    headers: {
      // The playback URL is presigned and expires, so never cache the answer.
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
