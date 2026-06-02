import * as React from "react";

export interface ChartTooltipRow {
  name: string;
  value: string;
  color: string;
}

/**
 * Tooltip card matching the shared TrendChart visual: a header, then one row
 * per series with a color swatch, name, and big formatted value. Used by the
 * pure-CSS admin charts that survived the Recharts → shared-SVG migration
 * (`FunnelBar`, `Heatmap`); the line/area/donut charts now bake their own
 * tooltip into `@eins/ui`.
 */
export function ChartTooltipCard({
  header,
  rows,
}: {
  header: React.ReactNode;
  rows: ChartTooltipRow[];
}) {
  return (
    <div className="pointer-events-none relative z-50 whitespace-nowrap rounded-md border border-border bg-bg-secondary px-3 py-2 shadow-xl">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {header}
      </div>
      <div className="mt-1 space-y-0.5">
        {rows.map((row, i) => (
          <div key={i} className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: row.color }}
            />
            {row.name ? (
              <span className="text-xs text-fg-secondary">{row.name}:</span>
            ) : null}
            <span className="font-display text-sm font-semibold tabular-nums text-fg-primary">
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
