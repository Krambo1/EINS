export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-96 max-w-full animate-pulse rounded bg-bg-secondary" />
      </header>

      {/* Search bar placeholder */}
      <div className="h-12 w-full animate-pulse rounded-md border border-border bg-bg-secondary" />

      {/* Question rows */}
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-xl border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
