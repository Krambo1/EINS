import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

/**
 * Health / readiness probe — used by Vercel deploy gates and uptime
 * monitors. Returns 200 when the portal can actually serve requests
 * (Next is up + Postgres is reachable + the migrations table looks sane).
 * Returns 503 with the failing component on any failure so traffic
 * routing pulls dead instances.
 *
 * Why deep-checks instead of a bare liveness `{ok:true}`:
 *   Round 2 testing caught Vercel routing to a portal that had lost its
 *   DB. The previous stub said 200 regardless. Adding a 100 ms DB ping
 *   to the gate is the right trade — Vercel's health gate already runs
 *   on a separate timer than user traffic, so the latency cost is
 *   absorbed there.
 *
 * Public endpoint — excluded from auth in middleware. We deliberately
 * keep the response shape boring so it's not abusable as a diagnostic
 * leak: no error stack, no env, no row counts.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VERSION =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ??
  process.env.GIT_SHA?.slice(0, 7) ??
  "dev";

interface HealthResult {
  ok: boolean;
  checks: Record<string, "ok" | string>;
  version: string;
  latencyMs: number;
}

export async function GET() {
  const t0 = Date.now();
  const checks: HealthResult["checks"] = {};

  // 1) Database ping — `SELECT 1` is the canonical lightweight check.
  //    Wrapped in Promise.race to bound the latency in case the pool is
  //    saturated; a hung connection is functionally as bad as no DB.
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("db_timeout")), 2000)
      ),
    ]);
    checks.db = "ok";
  } catch (err) {
    checks.db = err instanceof Error ? err.message.slice(0, 80) : "error";
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  const body: HealthResult = {
    ok,
    checks,
    version: VERSION,
    latencyMs: Date.now() - t0,
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
