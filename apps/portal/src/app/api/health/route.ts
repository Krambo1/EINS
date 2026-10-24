import { NextResponse, after } from "next/server";
import { sql } from "drizzle-orm";
import { assertAppRoleIsRlsSubject, db, dbApp } from "@/db/client";
import {
  WORKER_BEAT_NAME,
  getLastBeat,
  isWorkerStale,
} from "@/server/worker-heartbeat";
import { notifyOps } from "@/server/ops-alerts";
import { migrationStatus } from "@/server/migration-status";
import { configSummary } from "@/lib/env";

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
 * leak: no error stack, no env values, no row counts. `config` is a
 * presence summary (booleans only) and never affects `ok`: a missing optional
 * integration (Meta, Google, R2, Resend) must not page as "portal down".
 * Liveness contract kept: 200 + `ok:true`, 503 + failing `checks` entry.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HealthResult {
  ok: boolean;
  /** Set to `worker_stale` when the Fly worker has stopped beating. */
  reason?: "worker_stale";
  checks: Record<string, "ok" | string>;
  /** Which integrations are configured (booleans only, informational). */
  config: Record<string, boolean>;
  /** Non-blocking facts: migration check unknown, statement_timeout as seen
   *  through the app connection (pooler may drop startup params, A-22). */
  info?: Record<string, string>;
  latencyMs: number;
}

/** Neon can take a few seconds to wake a suspended compute. 2 s produced
 *  false "down" alarms on cold starts, so the ping gets 5 s. */
const DB_PING_TIMEOUT_MS = 5000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function GET() {
  const t0 = Date.now();
  const checks: HealthResult["checks"] = {};

  // 1) Database ping — `SELECT 1` is the canonical lightweight check.
  //    Wrapped in Promise.race to bound the latency in case the pool is
  //    saturated; a hung connection is functionally as bad as no DB.
  try {
    await withTimeout(db.execute(sql`SELECT 1`), DB_PING_TIMEOUT_MS, "db_timeout");
    checks.db = "ok";
  } catch (err) {
    // Fixed codes only: driver messages can name hosts/roles (public probe).
    checks.db =
      err instanceof Error && err.message === "db_timeout" ? "db_timeout" : "db_error";
  }
  const info: Record<string, string> = {};

  // 2) RLS-subject assertion (prod only): fail the gate if the app DB role
  //    can bypass row-level security (authn-07). Dev intentionally allows the
  //    superuser fallback, so we only enforce in production. Memoized in the
  //    client, so this is a cached boolean after the first probe.
  if (process.env.NODE_ENV === "production") {
    try {
      await assertAppRoleIsRlsSubject();
      checks.rls = "ok";
    } catch (err) {
      checks.rls = err instanceof Error ? err.message.slice(0, 80) : "error";
    }
  }

  // 3) Worker liveness: the Fly worker writes a beat every 60 s. If it dies,
  //    the PVS health scan, derive, link backfill, partition rotation and
  //    reconcile all stop without any error anywhere. A stale beat (> 10 min)
  //    fails the probe. No beat at all (never deployed / table missing) is NOT
  //    a failure: see isWorkerStale. Only the verdict leaves this route, never
  //    the timestamp, so the public response stays free of internals.
  if (checks.db === "ok") {
    const lastBeat = await getLastBeat(WORKER_BEAT_NAME);
    if (isWorkerStale(lastBeat, new Date())) {
      checks.worker = "worker_stale";
      // Page ops (rate-limited to one mail per 6 h inside notifyOps). `after`
      // keeps the send alive past the response on Vercel.
      after(() =>
        notifyOps({
          clinicId: null,
          kind: "worker_stale",
          severity: "high",
          title: "EINS-Worker meldet sich nicht mehr",
          body:
            "Der Fly-Worker (eins-worker) hat seit über 10 Minuten keinen " +
            "Heartbeat geschrieben. Solange er steht, laufen PVS-Health-Scan, " +
            "Status-Ableitung, Link-Backfill, Partitionsrotation und Reconcile " +
            "nicht. Prüfen: fly status -a eins-worker, fly logs -a eins-worker.",
        })
      );
    } else {
      checks.worker = "ok";
    }

    // 4) Migration drift: files shipped with this build that the DB has not
    //    applied yet mean pages will 500 on missing columns. Fails the probe.
    //    `unknown` (folder not in the bundle) is reported, not failed.
    try {
      const m = await withTimeout(migrationStatus(), DB_PING_TIMEOUT_MS, "db_timeout");
      if (m === "unknown") info.migrations = "unknown";
      else checks.migrations = m;
    } catch {
      checks.migrations = "error";
    }

    // 5) statement_timeout as the app role sees it (A-22). Informational.
    try {
      const rows = (await withTimeout(
        dbApp.execute(sql`SHOW statement_timeout`),
        DB_PING_TIMEOUT_MS,
        "db_timeout"
      )) as unknown as Array<{ statement_timeout?: string }>;
      if (rows[0]?.statement_timeout) info.statementTimeout = rows[0].statement_timeout;
    } catch {
      info.statementTimeout = "unknown";
    }
  }

  const ok = Object.values(checks).every((v) => v === "ok");
  // Deliberately no version/git-SHA here: this endpoint is public and the
  // deployed commit fingerprint is a free recon signal. Deploy identity
  // lives in Vercel's own dashboard, not in the probe body.
  const body: HealthResult = {
    ok,
    ...(checks.worker === "worker_stale" ? { reason: "worker_stale" as const } : {}),
    checks,
    config: configSummary(),
    ...(Object.keys(info).length > 0 ? { info } : {}),
    latencyMs: Date.now() - t0,
  };

  return NextResponse.json(body, {
    status: ok ? 200 : 503,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
