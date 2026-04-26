export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-32 rounded bg-bg-secondary/40" />
        <div className="h-9 w-80 max-w-full animate-pulse rounded bg-bg-secondary/60" />
      </div>

      <nav className="flex flex-wrap gap-2 border-b border-border pb-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-24 rounded-md bg-bg-secondary/40"
          />
        ))}
      </nav>

      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </div>
    </div>
  );
}
