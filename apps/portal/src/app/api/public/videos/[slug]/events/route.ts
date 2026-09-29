import { NextResponse, type NextRequest } from "next/server";
import { trustedIpFromHeaders } from "@/lib/client-ip";
import { env } from "@/lib/env";
import { parseVideoEvent } from "@/lib/outreach-video";
import { recordVideoEvent } from "@/server/outreach-videos";
import { rateLimit } from "@/server/rate-limit";

/**
 * POST /api/public/videos/[slug]/events
 *
 * Beacon sink for the watch page. The browser sends `navigator.sendBeacon`
 * with a text/plain JSON body ({k, s, p?, i?}), which is a CORS "simple"
 * request: no preflight, and the page never reads the answer. The answer is
 * always 204 for a well-formed beacon, whether or not the slug exists, so the
 * route cannot be used to probe for valid links.
 *
 * Nothing is stored about the viewer except a daily HMAC of IP + user agent
 * (see viewerHash) and a coarse device class. No cookie is read or set.
 */

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": env.VIDEO_PUBLIC_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug } = await ctx.params;
  const ip = trustedIpFromHeaders(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip")
  );

  // A full viewing sends ~9 beacons; 300 per 10 minutes per IP leaves room
  // for a whole office on one NAT and still stops a flood.
  const rl = await rateLimit("outreach-video-event", ip ?? "anon", {
    limit: 300,
    windowSeconds: 600,
  });
  if (!rl.ok) {
    return new NextResponse(null, { status: 429, headers: corsHeaders() });
  }

  const event = parseVideoEvent(await request.text());
  if (!event) {
    return new NextResponse(null, { status: 400, headers: corsHeaders() });
  }

  await recordVideoEvent(slug, event, {
    ip,
    userAgent: request.headers.get("user-agent"),
  });
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}
