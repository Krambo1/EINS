"use client";

import * as React from "react";
import { formatNumber } from "@/lib/formatting";
import { ChartTooltipCard } from "./ChartTooltip";

interface Props {
  rows: { label: string; cells: number[] }[];
  columnLabels: string[];
  /** When the highest cell exceeds this, gradient saturation tops out earlier. */
  ceiling?: number;
}

/**
 * Mint-scale heatmap. Cell intensity = value / max-in-grid; capped to 1 for
 * legibility. Hover any cell to see a tooltip card with row + column + value,
 * matching the clinic-side TrendChart hover style.
 */
export function Heatmap({ rows, columnLabels, ceiling }: Props) {
  const max = Math.max(
    1,
    ceiling ??
      rows.reduce((acc, r) => Math.max(acc, ...r.cells), 0)
  );

  const [hover, setHover] = React.useState<
    | {
        row: string;
        column: string;
        value: number;
        color: string;
        // mouse position relative to wrapper
        x: number;
        y: number;
      }
    | null
  >(null);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  function handleEnter(
    e: React.PointerEvent<HTMLTableCellElement>,
    row: string,
    column: string,
    value: number,
    color: string
  ) {
    const wrap = wrapperRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    setHover({
      row,
      column,
      value,
      color,
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }

  function handleMove(e: React.PointerEvent<HTMLTableCellElement>) {
    setHover((prev) => {
      if (!prev) return prev;
      const wrap = wrapperRef.current;
      if (!wrap) return prev;
      const rect = wrap.getBoundingClientRect();
      return {
        ...prev,
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    });
  }

  function handleLeave() {
    setHover(null);
  }

  return (
    <div ref={wrapperRef} className="relative overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 px-2 py-1 text-left font-medium text-fg-secondary">
              Praxis
            </th>
            {columnLabels.map((c) => (
              <th
                key={c}
                className="px-2 py-1 text-center text-[10px] font-medium uppercase tracking-wider text-fg-secondary"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={columnLabels.length + 1}
                className="px-2 py-6 text-center text-fg-secondary"
              >
                Noch keine Aktivität in diesem Zeitraum.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="sticky left-0 max-w-[160px] truncate px-2 py-1 text-left text-fg-primary">
                {r.label}
              </td>
              {r.cells.map((v, i) => {
                const intensity = Math.min(1, v / max);
                const color =
                  v === 0
                    ? "var(--bg-tertiary)"
                    : `rgba(88, 186, 181, ${0.18 + intensity * 0.6})`;
                const isActive =
                  hover != null &&
                  hover.row === r.label &&
                  hover.column === (columnLabels[i] ?? "");
                return (
                  <td
                    key={i}
                    className="rounded-sm px-2 py-1 text-center font-mono text-[11px] tabular-nums transition-transform duration-100"
                    style={{
                      background: color,
                      color: intensity > 0.55 ? "white" : "var(--fg-primary)",
                      transform: isActive ? "scale(1.08)" : undefined,
                      boxShadow: isActive
                        ? "0 0 0 1.5px var(--fg-primary)"
                        : undefined,
                    }}
                    onPointerEnter={(e) =>
                      handleEnter(e, r.label, columnLabels[i] ?? "", v, color)
                    }
                    onPointerMove={handleMove}
                    onPointerLeave={handleLeave}
                  >
                    {v > 0 ? v : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {hover && (
        <div
          className="pointer-events-none absolute z-50"
          style={{
            left: hover.x,
            top: hover.y,
            transform: "translate(-50%, calc(-100% - 12px))",
          }}
        >
          <ChartTooltipCard
            header={`${hover.row} · ${hover.column}`}
            rows={[
              {
                name: "",
                value: formatNumber(hover.value),
                color:
                  hover.value === 0
                    ? "var(--fg-tertiary)"
                    : "rgb(88, 186, 181)",
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
