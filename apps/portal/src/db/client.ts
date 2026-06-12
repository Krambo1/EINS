import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { createHash } from "node:crypto";
import { env } from "../lib/env";
import * as schema from "./schema";

declare global {
  // eslint-disable-next-line no-var
  var __einsPgSuper: ReturnType<typeof postgres> | undefined;
  // eslint-disable-next-line no-var
  var __einsPgApp: ReturnType<typeof postgres> | undefined;
}

/**
 * Neon's pooled endpoint (host contains "-pooler") runs PgBouncer in
 * transaction mode, which does NOT support prepared statements. postgres.js
 * defaults to prepared statements, so against the pooler it must run with
 * `prepare: false` or queries intermittently fail with "prepared statement
 * ... does not exist". Direct endpoints keep prepared statements (a small win
 * on repeated queries). Auto-detected from the URL so moving the serverless
 * app onto the pooler is a pure env change: point DATABASE_URL[_APP] at the
 * `-pooler` host in Vercel and this flips automatically.
 *
 * Why it matters: on Vercel + Neon free tier the dashboard's ~15 queries open
 * up to 10 fresh Neon connections per cold/idle invocation; direct-endpoint
 * connect cost dominates the slow render. The pooler keeps warm Postgres
 * connections behind PgBouncer, so the app's connect is cheap.
 */
function usesPgBouncer(url: string): boolean {
  return /-pooler\./.test(url) || /[?&]pgbouncer=true\b/.test(url);
}

function clientOptions(url: string) {
  return {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // Default postgres.js behaviour (prepared statements) on direct endpoints;
    // disabled automatically when pointed at a PgBouncer/Neon pooler host.
    prepare: !usesPgBouncer(url),
    connection: { statement_timeout: 15000 },
    onnotice: () => void 0,
  } as const;
}

function superClient() {
  if (!globalThis.__einsPgSuper) {
    globalThis.__einsPgSuper = postgres(env.DATABASE_URL, clientOptions(env.DATABASE_URL));
  }
  return globalThis.__einsPgSuper;
}

function appClient() {
  // SECURITY: dbApp is the RLS-enforced connection. Falling back to
  // DATABASE_URL (the superuser/owner role) silently disables all RLS
  // policies, so the fallback is only tolerated outside production.
  if (!env.DATABASE_URL_APP && process.env.NODE_ENV === "production") {
    throw new Error(
      "DATABASE_URL_APP is not set. Refusing to fall back to the superuser " +
        "DATABASE_URL in production: that would bypass row-level security."
    );
  }
  // Distinctness guard: if DATABASE_URL_APP is set but identical to the
  // superuser DATABASE_URL, RLS is silently off even though the env "looks"
  // configured. Fail closed in production (pentest C1 distinctness arm). The
  // runtime role check (assertAppRoleIsRlsSubject) is the deeper backstop.
  if (
    env.DATABASE_URL_APP &&
    env.DATABASE_URL_APP === env.DATABASE_URL &&
    process.env.NODE_ENV === "production"
  ) {
    throw new Error(
      "DATABASE_URL_APP must be a distinct, non-superuser role — it is the " +
        "same DSN as DATABASE_URL, which bypasses row-level security."
    );
  }
  const url = env.DATABASE_URL_APP ?? env.DATABASE_URL;
  if (!globalThis.__einsPgApp) {
    globalThis.__einsPgApp = postgres(url, clientOptions(url));
  }
  return globalThis.__einsPgApp;
}

/** Drizzle instance bound to the superuser connection (bypasses RLS). */
export const db = drizzle(superClient(), { schema });

/** Drizzle instance bound to the RLS-enforced app role. */
export const dbApp = drizzle(appClient(), { schema });

export const sqlClient = superClient();
export const sqlClientApp = appClient();

/**
 * Run `fn` inside a transaction with Postgres session variables set
 * so RLS policies resolve correctly. Session vars use `set_config(..., true)`
 * (transaction-scoped) so they do NOT leak between pooled connections.
 *
 * Emits a structured `kind:db` log line with elapsed time. If the total
 * exceeds DB_SLOW_MS (default 50), the line is tagged `level:warn` so
 * slow paths are filterable. The optional `label` lets callers tag the
 * call-site (e.g. "dashboard:summary") without sprinkling timers in pages.
 */
const DB_SLOW_MS = Number(process.env.DB_SLOW_MS ?? 50);

/**
 * Stable, non-reversible token for a clinic id in logs. Correlates per-tenant
 * activity in a shared log drain WITHOUT shipping the raw clinic UUID (a
 * navigational handle in the admin portal) into Sentry / Vercel logs
 * (pentest L3 / AZ-07).
 */
function clinicLogId(clinicId: string): string {
  return createHash("sha256").update(clinicId).digest("hex").slice(0, 12);
}

export async function withClinicContext<T>(
  clinicId: string,
  userId: string | null,
  fn: (tx: typeof dbApp) => Promise<T>,
  label?: string
): Promise<T> {
  const startedAt = performance.now();
  let setLocalMs = 0;
  try {
    return await dbApp.transaction(async (tx) => {
      const setLocalStart = performance.now();
      await tx.execute(sql`
        SELECT
          set_config('app.current_clinic_id', ${clinicId}, true),
          set_config('app.current_user_id', ${userId ?? ""}, true)
      `);
      setLocalMs = performance.now() - setLocalStart;
      return await fn(tx as unknown as typeof dbApp);
    });
  } finally {
    const ms = performance.now() - startedAt;
    const level = ms > DB_SLOW_MS ? "warn" : "info";
    console.log(
      JSON.stringify({
        kind: "db",
        level,
        label: label ?? "anon",
        ms: Math.round(ms * 10) / 10,
        setLocalMs: Math.round(setLocalMs * 10) / 10,
        clinicId: clinicLogId(clinicId),
      })
    );
  }
}

let rlsSubjectAssertion: Promise<void> | null = null;

/**
 * Assert the app connection's role is an RLS SUBJECT: not a superuser and
 * not BYPASSRLS. Runtime backstop for authn-07 — the env guard refuses a
 * missing DATABASE_URL_APP in production, but a URL that points at a
 * privileged role would still silently disable every RLS policy. The only
 * fail-closed mechanism (`app_current_clinic()` NULL) is fully defeated by a
 * superuser connection, so we verify the role itself.
 *
 * Memoized: the real catalog query runs once per process; a failure resets
 * the cache so the next caller retries. Surfaced via /api/health in prod.
 */
export function assertAppRoleIsRlsSubject(): Promise<void> {
  if (!rlsSubjectAssertion) {
    rlsSubjectAssertion = (async () => {
      const rows = (await dbApp.execute(sql`
        SELECT rolsuper, rolbypassrls
        FROM pg_roles
        WHERE rolname = current_user
      `)) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
      const role = rows[0];
      if (!role) {
        throw new Error(
          "RLS-subject assertion: current_user missing from pg_roles"
        );
      }
      if (role.rolsuper || role.rolbypassrls) {
        throw new Error(
          "RLS-subject assertion failed: the app DB role is a superuser or " +
            "has BYPASSRLS, so row-level security is NOT enforced. Point " +
            "DATABASE_URL_APP at the non-privileged eins_app role."
        );
      }
    })().catch((err) => {
      rlsSubjectAssertion = null;
      throw err;
    });
  }
  return rlsSubjectAssertion;
}

export { schema };
