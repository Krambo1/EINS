import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * First-party Web Vitals sink. Just logs to stdout — Vercel Log Drains pick
 * it up. Add a SIEM destination here if you want SLO alerting.
 */

const rumSchema = z.object({
  name: z.enum(["LCP", "CLS", "INP", "TTFB"]),
  value: z.number(),
  clinic: z.string().min(1),
  treatment: z.string().min(1),
  url: z.string().min(1),
  ua: z.string().optional(),
  connection: z.string().optional(),
});

export async function POST(req: NextRequest) {
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
