export default function Loading() {
  return (
    <div className="space-y-8" aria-busy="true" aria-live="polite">
      <header className="space-y-2">
        <div className="h-9 w-56 animate-pulse rounded bg-bg-secondary/60" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary/40" />
      </header>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-44 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </section>

      <div className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
    </div>
  );
}
