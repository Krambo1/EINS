/**
 * Skeleton for the heavy /auswertung detail bundle (18 parallel queries).
 * Approximates the deep-dive layout — daily card, breakdowns, response,
 * heatmaps, cohorts, staff, LTV — so swap-in is layout-stable.
 */
export function AuswertungDetailBundleSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="h-32 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="h-64 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
        <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      </div>
      <div className="h-64 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
    </div>
  );
}
