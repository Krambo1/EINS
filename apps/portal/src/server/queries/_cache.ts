import "server-only";
import { unstable_cache } from "next/cache";
import { berlinDay } from "@/lib/dashboard-range";

/**
 * Tenant-keyed wrapper around `unstable_cache` for clinic-scoped reads.
 *
 * Why this exists:
 *   The KPI aggregation queries (kpis.ts, attribution.ts, lifecycle.ts)
 *   are called from /dashboard. They run
 *   per-clinic, parameterised by date range (and a few extras like limit,
 *   weeks, etc.). Without caching, every render re-hits Postgres for
 *   numbers that are at most "fresh as of the last worker rebuild" anyway.
 *
 * Multi-tenancy invariant (HARD RULE — see audit hard rules):
 *   Cache key MUST include clinicId. The wrapper enforces this — if
 *   `clinicId` is falsy at runtime the call throws before the cache is
 *   consulted. Cross-tenant cache reuse would be catastrophic.
 *
 * Date normalization:
 *   Date arguments are normalized to the Berlin day YYYY-MM-DD before keying so the
 *   cache hits across requests within the same calendar day. Pages
 *   today create `new Date()` per request (millisecond-precise) → without
 *   normalization the cache would miss every time.
 *
 * Invalidation:
 *   The TTL is the real freshness guarantee. Each entry is tagged
 *   `kpi:<clinicId>`, but `revalidateTag` only works inside a Next request
 *   (route handler or server action). From the pg-boss worker (separate
 *   Node process) and during a server-component render it throws and
 *   `invalidateClinicKpiCache` only logs. So: dashboard reads use
 *   SHORT_REVALIDATE_S (30 s) because their values are live; mutations in
 *   server actions / route handlers (e.g. the daily cron route) may call
 *   `invalidateClinicKpiCache` to make the next render fresh at once.
 *
 * Never cache a role-dependent result here: the key carries clinicId (and
 * optionally userId), never the role, so the first caller's role would be
 * served to everyone in the Praxis. Filter by role after the cached read.
 *
 * userId in the cache key:
 *   Omitted by default. The aggregations are clinic-scoped — different
 *   users in the same clinic see the same numbers, so caching across
 *   them within a clinic is safe and improves hit rate. Pass
 *   `keyByUser: true` if a query is genuinely user-scoped (none today).
 */

const DEFAULT_REVALIDATE_S = 600;

/**
 * Short TTL for the dashboard's per-card "fresh-ish" reads. The dashboard
 * re-renders its whole route on every TimeRangeToggle change, which would
 * otherwise re-hit Postgres for every card on every toggle. Caching these
 * per (clinic, window) means switching one card only misses that card's key;
 * every other card serves from cache. Kept short so the dashboard's "today's
 * numbers within seconds" contract is relaxed by at most this window, and
 * these entries are still tag-busted by the kpi-rebuild worker so the
 * normal-case freshness is unchanged.
 */
export const SHORT_REVALIDATE_S = 30;

interface CacheOpts {
  /** Indices in `args` that hold Date objects to normalize for the key. */
  dateArgs?: number[];
  /** Override TTL in seconds. */
  revalidate?: number;
  /** Set true if the query is user-scoped (not just clinic-scoped). */
  keyByUser?: boolean;
}

/** Berlin calendar day: the dashboard windows are whole Berlin days. */
function dateOnly(d: Date): string {
  return berlinDay(d);
}

/** JSON with sorted object keys, so `{a,b}` and `{b,a}` share one entry. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * Wrap a (clinicId, userId, ...args) → Promise<T> function with
 * tag-based caching. The returned function has the same signature.
 */
export function cacheClinicQuery<TArgs extends unknown[], TResult>(
  fnName: string,
  fn: (clinicId: string, userId: string, ...args: TArgs) => Promise<TResult>,
  opts: CacheOpts = {}
): (clinicId: string, userId: string, ...args: TArgs) => Promise<TResult> {
  const { dateArgs = [], revalidate = DEFAULT_REVALIDATE_S, keyByUser = false } = opts;

  return async (clinicId: string, userId: string, ...args: TArgs): Promise<TResult> => {
    if (!clinicId) {
      // Fail loud — a falsy clinicId would mean "shared cache key across
      // tenants" and silently leak data. Refuse.
      throw new Error(
        `cacheClinicQuery(${fnName}): clinicId is required and must be non-empty`
      );
    }

    const keyParts: string[] = [fnName, clinicId];
    if (keyByUser) keyParts.push(userId);

    args.forEach((a, i) => {
      if (dateArgs.includes(i) && a instanceof Date) {
        keyParts.push(dateOnly(a));
      } else if (a instanceof Date) {
        keyParts.push(a.toISOString());
      } else if (a == null) {
        keyParts.push("null");
      } else if (typeof a === "object") {
        keyParts.push(stableStringify(a));
      } else {
        keyParts.push(String(a));
      }
    });

    return unstable_cache(
      () => fn(clinicId, userId, ...args),
      keyParts,
      {
        tags: [`kpi:${clinicId}`],
        revalidate,
      }
    )();
  };
}

/**
 * Invalidate all cached aggregation reads for a clinic. Effective only when
 * called from a server action or route handler; elsewhere (worker process,
 * render) Next throws and we fall back to the TTL (see header).
 *
 * Imported lazily to avoid pulling Next's request-context machinery into
 * tools that don't need it.
 */
export async function invalidateClinicKpiCache(clinicId: string): Promise<void> {
  if (!clinicId) return;
  try {
    const { revalidateTag } = await import("next/cache");
    revalidateTag(`kpi:${clinicId}`);
  } catch (err) {
    console.warn(
      `[kpi-cache] revalidateTag failed for clinic=${clinicId}; falling back to TTL`,
      err
    );
  }
}
