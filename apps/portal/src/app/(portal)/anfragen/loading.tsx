export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-40 animate-pulse rounded bg-bg-secondary/60" />
        <div className="h-4 w-80 max-w-full rounded bg-bg-secondary/40" />
      </header>

      <div className="flex flex-wrap gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-10 w-32 rounded-md bg-bg-secondary/40"
          />
        ))}
      </div>

      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border bg-bg-secondary/30"
          />
        ))}
      </div>
    </div>
  );
}
