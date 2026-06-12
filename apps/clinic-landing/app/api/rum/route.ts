import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allowRequest, clientIpFromHeaders } from "@/lib/rate-limit-mem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * First-party Web Vitals sink. Just logs to stdout — Vercel Log Drains pick
 * it up. Add a SIEM destination here if you want SLO alerting.
 */

// Field caps: this is an unauthenticated log sink, so every string is
// attacker-controlled and lands in our log drain. Bound each one to stop
// log-forging / log-bloat (pentest authn-08-telemetry).
const rumSchema = z.object({
  name: z.enum(["LCP", "CLS", "INP", "TTFB"]),
  value: z.number().finite(),
  clinic: z.string().min(1).max(120),
  treatment: z.string().min(1).max(120),
  url: z.string().min(1).max(512),
  ua: z.string().max(512).optional(),
  connection: z.string().max(64).optional(),
});

// One page load emits ~5 vitals; 120/min per IP is generous for real users.
const RUM_LIMIT_PER_MINUTE = 120;

export async function POST(req: NextRequest) {
  const ip = clientIpFromHeaders(req.headers);
  if (!allowRequest(ip, RUM_LIMIT_PER_MINUTE)) {
    return new NextResponse(null, { status: 429 });
  }

  let raw: unknown = null;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }
  const parse = rumSchema.safeParse(raw);
  if (!parse.success) return NextResponse.json({ ok: true });
  const v = parse.data;

  // Single-line JSON for log-drain ingestion.
  console.log(
    JSON.stringify({
      type: "web_vitals",
      ts: new Date().toISOString(),
      ...v,
    }),
  );
  return NextResponse.json({ ok: true });
}
