export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-44 animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-80 max-w-full rounded bg-bg-secondary" />
      </header>

      <div className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-32 rounded-full bg-bg-secondary"
          />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-md border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
