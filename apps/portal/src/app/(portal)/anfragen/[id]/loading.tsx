export default function Loading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-24 rounded bg-bg-secondary/40" />
        <div className="h-9 w-72 max-w-full animate-pulse rounded bg-bg-secondary/60" />
      </div>

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-md border border-border bg-bg-secondary/30"
            />
          ))}
        </div>
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-32 animate-pulse rounded-md border border-border bg-bg-secondary/30"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
