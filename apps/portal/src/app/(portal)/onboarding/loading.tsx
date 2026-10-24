export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary" />
      </header>

      <div className="h-3 w-full animate-pulse rounded-full bg-bg-secondary" />

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
