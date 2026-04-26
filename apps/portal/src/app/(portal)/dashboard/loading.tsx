/**
 * Render-immediately skeleton while the dashboard's parallel queries run.
 * Pulse classes only — no client interactivity, no JS impact.
 */
export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-bg-secondary/60" />
          <div className="h-9 w-48 animate-pulse rounded bg-bg-secondary/60" />
          <div className="h-4 w-72 rounded bg-bg-secondary/40" />
        </div>
        <div className="h-4 w-40 rounded bg-bg-secondary/40" />
      </div>

      <section className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-32 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-xl border border-border bg-bg-secondary/40"
          />
        ))}
      </section>

      <div className="h-48 animate-pulse rounded-xl border border-border bg-bg-secondary/40" />
    </div>
  );
}
