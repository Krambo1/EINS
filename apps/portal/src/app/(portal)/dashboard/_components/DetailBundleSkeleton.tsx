/**
 * Skeleton rendered while the detail bundle's queries are in flight.
 * Mirrors the shape of the deep-dive cards (Trichter + Behandlungs-
 * Aufschlüsselung in row one, Reputation + No-Show-Quote in row two) so the
 * eventual content swap is layout-stable.
 */
export function DetailBundleSkeleton() {
  const tileStyle = {
    backgroundColor: "var(--bg-card)",
    boxShadow: "var(--shadow-card)",
  } as const;
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="grid gap-6 lg:grid-cols-2">
        <div
          className="h-72 animate-pulse rounded-xl border border-border"
          style={tileStyle}
        />
        <div
          className="h-72 animate-pulse rounded-xl border border-border"
          style={tileStyle}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div
          className="h-72 animate-pulse rounded-xl border border-border"
          style={tileStyle}
        />
        <div
          className="h-72 animate-pulse rounded-xl border border-border"
          style={tileStyle}
        />
      </div>
    </div>
  );
}
