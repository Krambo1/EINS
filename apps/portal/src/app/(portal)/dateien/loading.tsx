export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-56 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary" />
      </header>

      <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary" />

      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
