export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-40 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-80 max-w-full rounded bg-bg-secondary" />
      </header>

      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-9 w-28 rounded-full bg-bg-secondary"
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="aspect-video animate-pulse rounded-xl border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
