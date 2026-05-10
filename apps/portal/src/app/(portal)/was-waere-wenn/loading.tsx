export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-64 animate-pulse rounded bg-bg-secondary/60" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary/40" />
      </header>

      <div className="h-40 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />

      <div className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </div>
    </div>
  );
}
