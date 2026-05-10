export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-44 animate-pulse rounded bg-bg-secondary/60" />
        <div className="h-4 w-80 max-w-full rounded bg-bg-secondary/40" />
      </header>

      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl border border-border bg-bg-secondary/30"
          />
        ))}
      </div>
    </div>
  );
}
