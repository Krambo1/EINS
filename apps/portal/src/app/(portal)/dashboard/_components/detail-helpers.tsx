import * as React from "react";
import { cn } from "@eins/ui";

/**
 * Small co-located helpers for the dashboard deep-dive bundle (also reused by
 * Werbebudget). Kept inside the page folder to avoid bloating @eins/ui until
 * we've used the same shape on three different pages. Server components — no
 * hooks, no events, no state.
 */

// ---------- Shared tone vocabulary ----------
export type BreakdownTone = "neutral" | "accent" | "good" | "warn" | "bad";

// ---------- DataTable: lightweight typed table ----------
export interface DataTableColumn<T> {
  key: keyof T | string;
  header: React.ReactNode;
  align?: "left" | "right";
  /** Hide this column below `md` (phone shows only the key columns). */
  hideBelowMd?: boolean;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  empty = "Keine Einträge.",
  fitPhone = false,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  empty?: string;
  /**
   * Below `md`: equal fixed column widths, tight padding, headers wrap
   * (hyphenated), right-aligned numbers never wrap. For tables whose phone
   * columns must fit the card without sideways scrolling.
   */
  fitPhone?: boolean;
}) {
  if (rows.length === 0) {
    return <p className="py-4 text-base text-fg-primary">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm", fitPhone && "table-fixed md:table-auto")}>
        <thead className="bg-bg-secondary text-left text-sm font-medium text-fg-primary">
          <tr>
            {columns.map((c) => (
              <th
                key={String(c.key)}
                className={cn(
                  "px-3 py-2.5 md:px-4",
                  fitPhone && "break-words px-1.5 align-bottom hyphens-auto md:hyphens-manual",
                  c.align === "right" ? "text-right" : "text-left",
                  c.hideBelowMd && "hidden md:table-cell"
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, idx) => (
            <tr key={idx} className="hover:bg-bg-secondary">
              {columns.map((c) => (
                <td
                  key={String(c.key)}
                  className={cn(
                    "px-3 py-2.5 tabular-nums md:px-4",
                    fitPhone && "break-words px-1.5",
                    fitPhone && c.align === "right" && "whitespace-nowrap",
                    c.align === "right" ? "text-right" : "text-left",
                    c.hideBelowMd && "hidden md:table-cell"
                  )}
                >
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
