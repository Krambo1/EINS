export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-9 w-72 max-w-full animate-pulse rounded bg-bg-secondary" />
        <div className="h-4 w-96 max-w-full rounded bg-bg-secondary" />
      </div>

      <section className="grid gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-bg-secondary"
          />
        ))}
      </section>

      <div className="h-72 animate-pulse rounded-xl border border-border bg-bg-secondary" />

      <section className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-56 animate-pulse rounded-xl border border-border bg-bg-secondary"
          />
        ))}
      </section>
    </div>
  );
}
