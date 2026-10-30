"use client";

import { Children, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { setSearchParams } from "@/app/_components/instant-views";

/**
 * "Alle Videos" with the archive toggle, filtered in the browser: the server
 * sends active and archived rows once (`instant`), the toggle only rewrites
 * `?archiviert=`, so it switches at once and a reload opens the same view.
 * When the list hit the query's row cap the server filters instead and the
 * toggle is a plain link.
 */
export function VideoList({
  archived,
  instant,
  children,
}: {
  /** Per row, in the order of the rows: archived or not. */
  archived: boolean[];
  instant: boolean;
  children: ReactNode;
}) {
  const showArchived = useSearchParams().get("archiviert") === "1";
  const rows = Children.toArray(children);
  const shown = instant && !showArchived ? rows.filter((_, i) => !archived[i]) : rows;

  return (
    <>
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-lg font-semibold">Alle Videos</h2>
        <Link
          href={showArchived ? "/admin/videos" : "/admin/videos?archiviert=1"}
          scroll={false}
          onClick={(e: MouseEvent<HTMLAnchorElement>) => {
            if (!instant || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            setSearchParams({ archiviert: showArchived ? null : "1", hinweis: null });
          }}
          className="text-sm text-accent underline-offset-4 hover:underline"
        >
          {showArchived ? "Nur aktive zeigen" : "Archivierte mit anzeigen"}
        </Link>
      </div>

      {shown.length === 0 ? (
        <p className="text-base text-fg-primary">Noch kein Video hochgeladen.</p>
      ) : (
        <div className="overflow-x-auto">
          {/* DS5: below md only Praxis (with last view and links), Aufrufe and Termin-Klick. */}
          <table className="w-full text-left text-sm md:min-w-[860px]">
            <thead className="border-b border-border text-fg-primary">
              <tr>
                <th className="py-2 pr-4 font-medium">Praxis</th>
                <th className="hidden py-2 pr-4 font-medium md:table-cell">Hochgeladen</th>
                <th className="py-2 pr-4 text-right font-medium">Aufrufe</th>
                <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Geräte</th>
                <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Gestartet</th>
                <th className="hidden py-2 pr-4 text-right font-medium md:table-cell">Am weitesten</th>
                <th className="py-2 pr-4 text-right font-medium">Termin-Klick</th>
                <th className="hidden py-2 pr-4 font-medium md:table-cell">Zuletzt angesehen</th>
                <th className="hidden py-2 font-medium md:table-cell" />
              </tr>
            </thead>
            <tbody>{shown}</tbody>
          </table>
        </div>
      )}
    </>
  );
}
