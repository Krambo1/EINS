import * as React from "react";
import { cn } from "@eins/ui";
import type { ToneKey } from "@/server/constants/admin";
import { AdminRowDetails } from "./AdminRowDetails";

/**
 * Shared admin table. Server component (so column `render` functions run on the
 * server, same as the dashboard `DataTable`), wrapped in an `overflow-x`
 * container, with one consistent header / row / hover treatment for every admin
 * surface. Columns flagged `secondary` are demoted out of the grid into a
 * per-row "Details" popover so wide tables (e.g. the 11-column clinics board)
 * stop overflowing while keeping every field reachable.
 */
export interface AdminColumn<T> {
  /** Stable key (also used for the React key on cells). */
  key: string;
  header: React.ReactNode;
  align?: "left" | "right";
  render: (row: T) => React.ReactNode;
  /** Demote into the per-row "Details" popover instead of its own column. */
  secondary?: boolean;
  /** Label shown for this field inside the Details popover. Defaults to `header`. */
  detailLabel?: React.ReactNode;
}

export interface AdminTableProps<T> {
  columns: AdminColumn<T>[];
  rows: T[];
  getRowKey?: (row: T, index: number) => string;
  empty?: React.ReactNode;
  className?: string;
}

/** Solid text-tone classes for cells (no broken `/NN` opacity tokens). */
export const TONE_TEXT: Record<ToneKey, string> = {
  good: "text-tone-good",
  warn: "text-tone-warn",
  bad: "text-tone-bad",
  neutral: "text-fg-secondary",
};

export function AdminTable<T>({
  columns,
  rows,
  getRowKey,
  empty = "Keine Einträge.",
  className,
}: AdminTableProps<T>) {
  const primary = columns.filter((c) => !c.secondary);
  const secondary = columns.filter((c) => c.secondary);
  const hasDetails = secondary.length > 0;
  const colCount = primary.length + (hasDetails ? 1 : 0);

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-bg-secondary text-left text-xs font-medium text-fg-secondary">
          <tr>
            {primary.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "px-3 py-2.5",
                  c.align === "right" ? "text-right" : "text-left"
                )}
              >
                {c.header}
              </th>
            ))}
            {hasDetails && (
              <th className="px-3 py-2.5 text-right">Details</th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={colCount}
                className="px-4 py-10 text-center text-fg-secondary"
              >
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr
                key={getRowKey ? getRowKey(row, i) : i}
                className="hover:bg-bg-secondary"
              >
                {primary.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2.5 tabular-nums",
                      c.align === "right" ? "text-right" : "text-left"
                    )}
                  >
                    {c.render(row)}
                  </td>
                ))}
                {hasDetails && (
                  <td className="px-3 py-2.5 text-right">
                    <AdminRowDetails
                      items={secondary.map((c) => ({
                        label: c.detailLabel ?? c.header,
                        value: c.render(row),
                      }))}
                    />
                  </td>
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
