export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-56 animate-pulse rounded bg-bg-secondary/60" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary/40" />
      </header>

      <nav className="flex flex-wrap gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-9 w-20 rounded-full bg-bg-secondary/40"
          />
        ))}
      </nav>

      <section className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </section>

      <div className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
      <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
    </div>
  );
}
