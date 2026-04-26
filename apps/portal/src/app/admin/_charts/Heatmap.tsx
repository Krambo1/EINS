import * as React from "react";

interface Props {
  rows: { label: string; cells: number[] }[];
  columnLabels: string[];
  /** When the highest cell exceeds this, gradient saturation tops out earlier. */
  ceiling?: number;
}

/**
 * Mint-scale heatmap. Rendered server-side — pure CSS.
 * Cell intensity = value / max-in-grid; capped to 1 for legibility.
 */
export function Heatmap({ rows, columnLabels, ceiling }: Props) {
  const max = Math.max(
    1,
    ceiling ??
      rows.reduce((acc, r) => Math.max(acc, ...r.cells), 0)
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 px-2 py-1 text-left font-medium text-fg-secondary">
              Klinik
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
                const bg =
                  v === 0
                    ? "var(--bg-tertiary)"
                    : `rgba(88, 186, 181, ${0.18 + intensity * 0.6})`;
                return (
                  <td
                    key={i}
                    className="rounded-sm px-2 py-1 text-center font-mono text-[11px] tabular-nums"
                    style={{
                      background: bg,
                      color: intensity > 0.55 ? "white" : "var(--fg-primary)",
                    }}
                    title={`${r.label} · ${columnLabels[i] ?? ""}: ${v}`}
                  >
                    {v > 0 ? v : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
