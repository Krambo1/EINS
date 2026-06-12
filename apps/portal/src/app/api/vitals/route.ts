import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "edge";

const VitalSchema = z.object({
  name: z.enum(["LCP", "INP", "CLS", "FCP", "TTFB"]),
  value: z.number().finite(),
  id: z.string().min(1).max(128),
  rating: z.enum(["good", "needs-improvement", "poor"]).optional(),
  route: z.string().max(256).optional(),
});

/**
 * Per-IP rate limit. This is an unauthenticated log sink, so without a cap
 * it is a free cost-amplification target. The edge runtime has no access to
 * the Postgres-backed limiter (server-only, node), so a per-isolate
 * fixed-window map is the pragmatic bound: a single page load emits ~5
 * vitals, so 60/min per IP is generous for real users and cheap to enforce.
 */
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 60;
const buckets = new Map<string, { count: number; windowStart: number }>();

function allowRequest(ip: string): boolean {
  const now = Date.now();
  if (buckets.size > 10_000) buckets.clear(); // unbounded-growth backstop
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count++;
  return bucket.count <= LIMIT_PER_WINDOW;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowRequest(ip)) {
    return new NextResponse(null, { status: 429 });
  }

  let parsed: z.infer<typeof VitalSchema>;
  try {
    const body = (await req.json()) as unknown;
    parsed = VitalSchema.parse(body);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // Structured log line — pickable by any log aggregator with a `kind:vitals` filter.
  console.log(
    JSON.stringify({
      kind: "vitals",
      name: parsed.name,
      value: Math.round(parsed.value * 100) / 100,
      rating: parsed.rating ?? null,
      route: parsed.route ?? null,
      id: parsed.id,
    })
  );

  return new NextResponse(null, { status: 204 });
}
