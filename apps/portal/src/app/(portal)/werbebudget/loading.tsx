// Soft off-white card surface + lift shadow, matching the loaded page and the
// dashboard's skeletons so the loading state doesn't flash a different look.
const SKELETON = {
  backgroundColor: "var(--bg-card)",
  boxShadow: "var(--shadow-card)",
} as const;

export default function Loading() {
  return (
    <div className="space-y-10" aria-busy="true" aria-live="polite">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <div className="h-9 w-56 animate-pulse rounded bg-bg-secondary" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-bg-secondary" />
        </div>
        <div className="h-9 w-44 animate-pulse rounded-full bg-bg-secondary" />
      </header>

      {/* Hero numbers + Pace, each now a single elevated card. */}
      <div
        className="h-28 animate-pulse rounded-2xl border border-border"
        style={SKELETON}
      />
      <div
        className="h-32 animate-pulse rounded-2xl border border-border"
        style={SKELETON}
      />

      {/* Per-platform cards. */}
      <section className="grid gap-6 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div
            key={i}
            className="h-72 animate-pulse rounded-lg border border-border"
            style={SKELETON}
          />
        ))}
      </section>

      <div
        className="h-64 animate-pulse rounded-lg border border-border"
        style={SKELETON}
      />
    </div>
  );
}
