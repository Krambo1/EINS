/**
 * Stable-height skeleton rendered while a chart's recharts chunk is in
 * flight. Server-renderable. Pair with `<div style={{height}}>` from the
 * wrapper so the skeleton fills the same box the chart will occupy --
 * no CLS on hydration.
 */
export function ChartSkeleton() {
  return (
    <div
      className="h-full w-full animate-pulse rounded-md bg-bg-secondary/50"
      aria-hidden="true"
    />
  );
}
