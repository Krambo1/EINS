import { DetailBundleSkeleton, TopMetricsSkeleton } from "./_components/DetailBundleSkeleton";

/**
 * Render-immediately skeleton while the dashboard's parallel queries run.
 * Pulse classes only, no client interactivity. Same shape and heights as the
 * page: the range switch, the Kennzahlen with the row under them, then the
 * deep-dive cards.
 */
export default function Loading() {
  return (
    <div className="space-y-4 md:space-y-6" aria-busy="true" aria-live="polite">
      <div className="elev-inset h-[var(--track-h)] w-full rounded-[var(--r-panel)] bg-[var(--surface-inset)] md:w-80" />
      <TopMetricsSkeleton />
      <DetailBundleSkeleton />
    </div>
  );
}
