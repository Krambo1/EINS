"use client";

import { useMemo, useState } from "react";
import {
  createColumnHelper,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge } from "@eins/ui";
import { EventDetailDialog } from "./EventDetailDialog";

export interface EventRow {
  id: string;
  clinicId: string;
  clinicLabel: string;
  bridgeSource: string;
  kind: string;
  pvsExternalEventId: string;
  occurredAt: string;
  receivedAt: string;
}

interface Props {
  rows: EventRow[];
  truncated: boolean;
  hardCap: number;
}

const ROW_HEIGHT = 36;

const dtFormatter = new Intl.DateTimeFormat("de-DE", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function EventsPanel({ rows, truncated, hardCap }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Callback ref via useState — useRef alone leaves the scroll element
  // null on the first render, and @tanstack/react-virtual attaches its
  // ResizeObserver too early to ever catch the eventual element. The
  // state setter forces a re-render once the element mounts so the
  // virtualizer can pick it up via getScrollElement().
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);

  const columns = useMemo(() => buildColumns(), []);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const rowModel = table.getRowModel();
  const virtualizer = useVirtualizer({
    count: rowModel.rows.length,
    getScrollElement: () => scrollEl,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems[0]?.start ?? 0;
  const paddingBottom = totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0);

  return (
    <>
      {truncated && (
        <div className="rounded-md border border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)] px-3 py-2 text-xs text-fg-primary">
          Mehr als {hardCap.toLocaleString("de-DE")} passende Events. Es werden
          die {hardCap.toLocaleString("de-DE")} jüngsten gezeigt: Filter weiter
          einengen oder Zeitraum kürzen.
        </div>
      )}

      <div className="rounded-md border border-border bg-bg-primary">
        <div className="grid grid-cols-[160px_180px_120px_170px_1fr_120px] gap-3 border-b border-border bg-bg-secondary px-3 py-2 text-xs font-medium text-fg-secondary">
          <div>Zeitpunkt</div>
          <div>Praxis</div>
          <div>Adapter</div>
          <div>Typ</div>
          <div>Externe ID</div>
          <div className="text-right">Status</div>
        </div>

        <div
          ref={setScrollEl}
          className="relative overflow-auto"
          style={{ height: 560 }}
          role="grid"
          aria-rowcount={rowModel.rows.length}
        >
          {rowModel.rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-fg-secondary">
              Keine Events in diesem Zeitfenster.
            </div>
          ) : (
            <div style={{ paddingTop, paddingBottom }}>
              {virtualItems.map((vi) => {
                const row = rowModel.rows[vi.index];
                const r = row.original;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedId(r.id)}
                    className="grid w-full grid-cols-[160px_180px_120px_170px_1fr_120px] gap-3 border-b border-border px-3 py-1.5 text-left text-xs hover:bg-bg-secondary focus:bg-bg-secondary focus:outline-none"
                    style={{ height: ROW_HEIGHT }}
                    role="row"
                    aria-rowindex={vi.index + 1}
                  >
                    <span className="tabular-nums text-fg-secondary">
                      {dtFormatter.format(new Date(r.occurredAt))}
                    </span>
                    <span className="truncate" title={r.clinicLabel}>
                      {r.clinicLabel}
                    </span>
                    <span className="font-mono text-fg-secondary">
                      {r.bridgeSource}
                    </span>
                    <span>{r.kind}</span>
                    <span
                      className="truncate font-mono text-fg-tertiary"
                      title={r.pvsExternalEventId}
                    >
                      {r.pvsExternalEventId}
                    </span>
                    <span className="text-right">
                      <Badge tone="good" className="text-[10px]">
                        Ingested
                      </Badge>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-border bg-bg-secondary px-3 py-1.5 text-[11px] text-fg-tertiary">
          {rowModel.rows.length.toLocaleString("de-DE")} Events sichtbar
          {truncated ? ` (capped bei ${hardCap.toLocaleString("de-DE")})` : ""}
        </div>
      </div>

      <EventDetailDialog
        eventId={selectedId}
        onClose={() => setSelectedId(null)}
      />
    </>
  );
}

function buildColumns() {
  // The table instance exists primarily to give us `getRowModel()` for
  // the virtualizer plus a hook for future per-column sorting; the grid
  // layout above is hand-rolled (we want the same column widths in head
  // and body without TanStack's table-element constraints).
  const ch = createColumnHelper<EventRow>();
  return [
    ch.accessor("occurredAt", { id: "occurredAt" }),
    ch.accessor("clinicLabel", { id: "clinicLabel" }),
    ch.accessor("bridgeSource", { id: "bridgeSource" }),
    ch.accessor("kind", { id: "kind" }),
    ch.accessor("pvsExternalEventId", { id: "pvsExternalEventId" }),
    ch.display({ id: "status" }),
  ];
}
