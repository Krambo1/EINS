/**
 * Fallback für die gestreamte Anfragen-Liste. Spiegelt den Listen-Teil von
 * loading.tsx (Zeilen-Platzhalter), ohne Header und Filter, da diese in
 * eigenen Suspense-Grenzen bzw. synchron rendern.
 */
export function RequestListSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-4 w-28 rounded bg-bg-secondary" />

      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="h-14 animate-pulse rounded-md border border-border bg-bg-secondary"
          />
        ))}
      </div>
    </div>
  );
}
