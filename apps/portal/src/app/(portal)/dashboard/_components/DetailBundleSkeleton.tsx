/**
 * Skeleton rendered while the detail bundle's queries are in flight.
 * Mirrors the shape of the deep-dive cards (sparkline row, two-up sources/
 * response, three-up sync/reputation/recalls) so the eventual content swap
 * is layout-stable.
 */
export function DetailBundleSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-44 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
        <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      </div>
      <div className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
        <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
        <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      </div>
    </div>
  );
}
