## Summary

Test-first performance tier from the [audit plan](.claude/plans/portal-performance-parallel-dragon.md), stacked on top of `perf/portal-instrumentation-and-fixes`. Four commits, each independently reviewable:

1. **`701ae49`** — Stream dashboard + auswertung detail bundles via `<Suspense>`
2. **`184e951`** — `unstable_cache` on KPI aggregation queries (clinic-keyed, worker-invalidated)
3. **`f84280c`** — Rewrite stale-detection filter as `NOT EXISTS`
4. **`d63cbc9`** — `React.cache` for admin clinic-detail shared reads

**Depends on:** the prior `perf/portal-instrumentation-and-fixes` PR. The branch is stacked off it, not main. If that PR merges first, rebase this onto main; the diff is independent.

## Hard rules respected

- `withClinicContext` untouched — RLS boundary intact.
- Every cache key includes `clinicId`. The wrapper (`server/queries/_cache.ts:cacheClinicQuery`) refuses a falsy `clinicId` at runtime — cross-tenant cache reuse is impossible.
- Worker pre-aggregation stays where it is; nothing moved onto the request path.
- Detail-mode toggle (`session.uiMode === "detail"`) preserved unchanged.
- All claims below back-checked against `[db]` log lines, EXPLAIN plans, or `pnpm --filter portal build` output — no metric-free claims.
- Marketing-site renames in working tree left untouched.

## Item 1 — Suspense boundaries (commit `701ae49`)

**Before:** dashboard `await fetchDetail()` and auswertung `await fetchDetailBundle()` block all markup until 8 / 18 parallel queries finish. TTFB = max-of-bundle.

**After:** base shell paints from a 5-query (dashboard) / 3-query (auswertung) `Promise.all`. Top-metric grid streams the enriched `MetricTile` version inside `<Suspense>` with the `SimpleMetric` grid as fallback. Deep-dive cards stream inside a second `<Suspense>` with a height-stable skeleton.

| Surface | Pre-stream blocking queries | After |
|---|---|---|
| `/dashboard` (detail) | 13 | **5 base** + Suspense streams 2 (top metrics) + 8 (deep dive) |
| `/auswertung` (detail) | 21 | **3 base** + Suspense streams 2 (top metrics) + 18 (deep dive) |

Trade-off accepted (per audit plan): in detail mode the top-metric grid visually swaps from `SimpleMetric` → `MetricTile` when delta + sparkline data arrives. Worth it for the TTFB win; INP and TTFB are higher-priority p75 targets than LCP-stability per the brief.

## Item 2 — `unstable_cache` on KPI aggregation queries (commit `184e951`)

Cached:
- `kpis.ts` — `kpiSummary`, `kpiDailySeries`, `kpiSummaryWithComparison`, `kpiDailySeriesWithSparkline`
- `attribution.ts` — `bySource`, `byChannel`, `byCampaign`, `byTreatment`, `byLocation`
- `lifecycle.ts` — `responseTimeStats`, `responseTimeSeries`, `weekdayHeatmap`, `hourlyHeatmap`, `cohortRetention`, `aiScoreDistribution`

Not cached (hot/now path; the brief explicitly excluded them):
- `currentMonthSummary`, `currentGoals`, `recentRequestsCount`, `slaBreachedCount`, `requestStatusCounts`, `latestReviews`, `recallsDue`, `staffPerformance`

Mechanism (`server/queries/_cache.ts`):
- Cache key: `[fnName, clinicId, ...normalisedArgs]`. Date args truncated to `YYYY-MM-DD` so per-millisecond `new Date()` calls in pages don't bust the key.
- Tag: `kpi:<clinicId>` per entry.
- TTL safety net: 600s.
- `userId` deliberately omitted from the key (queries are clinic-scoped, not user-scoped — different users in the same clinic should share).
- `cacheClinicQuery` throws on a falsy `clinicId` so a missing prop can't silently share a key across tenants.

Worker invalidation (`worker/processors/kpi-rebuild.ts`): `invalidateClinicKpiCache(clinicId)` after a successful rebuild for that clinic. Wrapped in try/catch — `revalidateTag`'s cross-process behaviour isn't a hard guarantee (worker is a separate Node process), so the 600s TTL is the real ceiling on staleness.

### Brief premise correction

The brief described the attribution.ts and most lifecycle.ts targets as "reading pre-aggregated tables (`kpi_daily` / `campaign_snapshots`)". Verified that 11 of 16 cached functions actually read live `requests` data (e.g. `bySource`, `byChannel`, `responseTimeStats`, `weekdayHeatmap`...). Caching is still the right call — they're expensive aggregations and the worker invalidates on every kpi rebuild — but the freshness ceiling is "worker rebuild cadence" not "next request after worker", and the comment block in `_cache.ts` documents that.

### Multi-tenant smoke (HARD RULE)

Seeded a second clinic (`klinik-test-zwei`, 31 days × 5 leads/day = 155 leads) alongside the demo clinic (30 days × ~1 lead/day = 38 leads). Logged in as each clinic's user and loaded `/auswertung?period=30`. The `[db]` log lines show queries firing under each clinic's own `clinicId` — clinic 2's request didn't return cached values from clinic 1's earlier load. Cache wrapper code reviewed: `clinicId` is at index 1 of `keyParts` and is always present (the `if (!clinicId) throw` guard at `_cache.ts:67` enforces it).

## Item 3 — Stale-detection rewrite (commit `f84280c`)

`/anfragen?staleOnly=1` filter — replaced two correlated subqueries (`max(created_at) < N days` OR `count(*) = 0`) with a single `NOT EXISTS` over `request_activities` filtered to the last 14 days.

`EXPLAIN (ANALYZE, BUFFERS)` on the seed DB:

|  | Plan | Buffers | Execution time |
|---|---|---|---|
| Before | Index Scan on requests + `Filter: ((SubPlan 1) < ...) OR ((SubPlan 2) = 0)` — SubPlan iterations: 30 + 24 | 61 hits | 0.422 ms |
| After  | Hash Right Anti Join — single pass | **8 hits** | **0.215 ms** |

With `enable_seqscan=off` the AFTER plan switches to `Nested Loop Anti Join → Index Only Scan using request_activities_request_created_idx`. That's the eventual production plan once the activities table is large enough that the planner prefers the compound index over a seq scan; the index already exists from migration 0005 in the prior PR.

The structural win is per-request scaling: BEFORE re-runs a SubPlan per matched request (54 SubPlan iterations on 30 requests); AFTER does one hash join regardless of result size.

## Item 4 — `React.cache` for admin clinic-detail (commit `d63cbc9`)

Hoisted clinic lookup + clinic-counts aggregate from `admin/clinics/[id]/page.tsx` into `React.cache`-wrapped helpers in `server/queries/admin-shared.ts`. Pattern matches `getSession`/`getAdminSession` from the prior PR.

Today's render path issues each helper exactly once, so the immediate DB savings are zero. The win is forward-looking: any future tab subcomponent, breadcrumb, or sibling layout that wants the clinic record gets it free, and the inline `sql<number>` count subqueries are now a named helper.

`/admin/page.tsx` was also listed in the audit but its 9-way `Promise.all` fans out to 9 distinct read functions with no current overlap — the auth read is already shared via `getAdminSession`'s React.cache. No change needed there; flagged in the commit message so the absence isn't an oversight.

## Out of scope (test-first tier complete; structural tier untouched)

Per the brief's stop condition — when these four items are committed and verified, **stop**. Not in this PR:
- Per-request connection pinning for `withClinicContext` (RLS-boundary; needs explicit go-ahead)
- Materialized views for heatmap/cohort aggregations
- DB pool tuning + read replica
- Anything in `apps/website/`
- Suspense on `/anfragen` (low value; inline path already fast)

## Test plan

- [ ] `pnpm --filter portal typecheck` — passes (verified locally)
- [ ] `pnpm --filter portal build` — passes; bundle table unchanged from prior PR (`/dashboard` and `/auswertung` stay at 162 kB gz first-load JS)
- [ ] `pnpm db:up && pnpm db:migrate && pnpm dev:portal` — boots; both routes render without console errors
- [ ] `[db]` log lines show base bundle finishes before detail bundle in detail-mode loads
- [ ] Multi-tenant smoke: two clinic users in two browser profiles see different KPI numbers; cache layer doesn't bleed values across them
- [ ] Worker rebuild → next `/auswertung` render shows fresh numbers within `revalidateTag` propagation (or within 600s TTL fallback)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
