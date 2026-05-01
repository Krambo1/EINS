import "server-only";
import { unstable_cache } from "next/cache";

/**
 * Tenant-keyed wrapper around `unstable_cache` for clinic-scoped reads.
 *
 * Why this exists:
 *   The KPI aggregation queries (kpis.ts, attribution.ts, lifecycle.ts)
 *   are called from /dashboard and /auswertung in detail mode. They run
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
 *   Date arguments are normalized to YYYY-MM-DD before keying so the
 *   cache hits across requests within the same calendar day. Pages
 *   today create `new Date()` per request (millisecond-precise) → without
 *   normalization the cache would miss every time.
 *
 * Invalidation:
 *   Each entry is tagged `kpi:<clinicId>`. The kpi-rebuild worker calls
 *   revalidateTag after a successful rebuild for that clinic so the
 *   cache flushes within seconds. The 600s TTL is the safety net if
 *   cross-process tag invalidation ever fails (worker runs in a separate
 *   Node process; revalidateTag's behaviour outside of a Next request
 *   context is best-effort).
 *
 * userId in the cache key:
 *   Omitted by default. The aggregations are clinic-scoped — different
 *   users in the same clinic see the same numbers, so caching across
 *   them within a clinic is safe and improves hit rate. Pass
 *   `keyByUser: true` if a query is genuinely user-scoped (none today).
 */

const DEFAULT_REVALIDATE_S = 600;

interface CacheOpts {
  /** Indices in `args` that hold Date objects to normalize for the key. */
  dateArgs?: number[];
  /** Override TTL in seconds. */
  revalidate?: number;
  /** Set true if the query is user-scoped (not just clinic-scoped). */
  keyByUser?: boolean;
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
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
        keyParts.push(JSON.stringify(a));
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
 * Worker-side: invalidate all cached aggregation reads for a clinic.
 * Wrapped in try/catch because revalidateTag's cross-process behaviour
 * isn't a hard guarantee — the 600s TTL is the safety net.
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
