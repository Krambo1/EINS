import { NextResponse } from "next/server";

/**
 * Liveness probe — called by Vercel deploy gates and uptime monitors.
 *
 * Deliberately cheap: no DB hop, no Redis ping. A 200 here means "Next
 * is serving"; deeper readiness (Postgres / Redis reachable) lives in
 * the admin status panel, not on a public unauthenticated endpoint.
 *
 * Excluded from auth in middleware.ts's matcher, so this stays reachable
 * without a session cookie.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ status: "ok" }, { status: 200 });
}
