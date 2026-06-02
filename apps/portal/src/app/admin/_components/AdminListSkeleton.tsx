/**
 * Shared loading skeleton for the admin list pages (users / integrations /
 * revenue / onboarding): page header, KPI strip, and a tall content block.
 */
export function AdminListSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-9 w-72 max-w-full animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-bg-secondary" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-2xl border border-border bg-bg-secondary"
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-2xl border border-border bg-bg-secondary" />
    </div>
  );
}
