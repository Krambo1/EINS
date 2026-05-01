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

export async function POST(req: Request) {
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
