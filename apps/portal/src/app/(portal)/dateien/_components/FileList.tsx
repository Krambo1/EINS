"use client";

import { Children, createContext, useContext, useMemo, useOptimistic, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { CONTROL, RAISED_CONTROL } from "../../dashboard/_components/dash-ui";
import { FILE_LIST, FILE_SLOTS, FileCount, FileEmpty } from "./file-ui";

type ListState = {
  kind: string | undefined;
  page: number;
  pages: number;
  /** Indexes of the rows the filter lets through, in order. */
  visible: number[];
  setKind: (kind: string | undefined) => void;
  setPage: (page: number) => void;
  /** Hides a row (by `rowIds`) until the running action ends: a deleted file
   *  leaves on the tap; the revalidated list then has it gone, or back on an
   *  error. Call it inside an action. */
  hide: (id: string) => void;
};

const ListContext = createContext<ListState | null>(null);

/** The list state of the card around this component, or null outside one. */
export function useFileList(): ListState | null {
  return useContext(ListContext);
}

function useList(): ListState {
  const s = useContext(ListContext);
  if (!s) throw new Error("must sit inside FileListState");
  return s;
}

/**
 * Pages and the Art filter of one Dateien card, in the browser. The server
 * renders every row once; switching a page or an Art only shows other rows,
 * so it is instant (no round trip, like the period switch on the dashboard).
 * The address follows with history.replaceState (`?von=2`, `?kind=vertrag`),
 * so a reload or a shared link opens the same view.
 */
export function FileListState({
  param,
  rowKinds,
  rowIds,
  initialKind,
  initialPage,
  children,
}: {
  /** Query key of this card's page ("von", "an"). */
  param: string;
  /** Per row, in the order of the rows: its Art, or null for rows shown only
   *  without a filter (the Anleitung and the Checkliste). */
  rowKinds: (string | null)[];
  /** Per row, its id, for rows that can be deleted from the list. */
  rowIds?: string[];
  initialKind?: string;
  initialPage: number;
  children: ReactNode;
}) {
  const [kind, setKindState] = useState(initialKind);
  const [asked, setAsked] = useState(initialPage);
  const [hidden, hide] = useOptimistic<ReadonlySet<string>, string>(new Set(), (s, id) => new Set(s).add(id));
  const visible = useMemo(
    () =>
      rowKinds.flatMap((k, i) => ((!kind || k === kind) && !(rowIds?.[i] && hidden.has(rowIds[i])) ? [i] : [])),
    [rowKinds, rowIds, hidden, kind]
  );
  const pages = Math.max(1, Math.ceil(visible.length / FILE_SLOTS));
  // A page past the end (rows deleted, a smaller Art) shows the last one.
  const page = Math.min(Math.max(asked, 1), pages);

  const state = useMemo<ListState>(() => {
    const sync = (changes: Record<string, string | undefined>) => {
      const q = new URLSearchParams(window.location.search);
      for (const [k, v] of Object.entries(changes)) {
        if (v) q.set(k, v);
        else q.delete(k);
      }
      const s = q.toString();
      window.history.replaceState(null, "", s ? `${window.location.pathname}?${s}` : window.location.pathname);
    };
    return {
      kind,
      page,
      pages,
      visible,
      setKind: (next) => {
        setKindState(next);
        setAsked(1);
        sync({ kind: next, [param]: undefined });
      },
      setPage: (next) => {
        setAsked(next);
        sync({ [param]: next > 1 ? String(next) : undefined });
      },
      hide,
    };
  }, [kind, page, pages, visible, param, hide]);

  return <ListContext.Provider value={state}>{children}</ListContext.Provider>;
}

/** The count after the card title: the rows the filter lets through. */
export function FileListCount() {
  return <FileCount n={useList().visible.length} />;
}

/** The current page of rows, or one sentence in the same space. */
export function FileListRows({
  empty,
  emptyFiltered,
  children,
}: {
  empty: ReactNode;
  /** When an Art is picked and nothing has it. */
  emptyFiltered?: ReactNode;
  children: ReactNode;
}) {
  const { visible, page, kind } = useList();
  const all = Children.toArray(children);
  const shown = visible.slice((page - 1) * FILE_SLOTS, page * FILE_SLOTS).map((i) => all[i]);
  if (shown.length === 0) return <FileEmpty>{kind && emptyFiltered ? emptyFiltered : empty}</FileEmpty>;
  return <ul className={FILE_LIST}>{shown}</ul>;
}

/**
 * Page buttons at the foot of a card, like Stripe's table footer: both on
 * every page, greyed out at the ends, so neither moves. With one page the
 * foot shows `hint` (or nothing) at the same height.
 */
export function FileListPager({ label, hint }: { label: string; hint?: ReactNode }) {
  const { page, pages, setPage } = useList();
  if (pages <= 1) return <>{hint}</>;
  const button = cn(RAISED_CONTROL, CONTROL);
  return (
    <nav aria-label={label} className="flex h-full items-end justify-between gap-3 border-t border-border px-2">
      <span className="flex h-[var(--control-h)] items-center text-sm tabular-nums text-fg-secondary" aria-live="polite">
        Seite {page} von {pages}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)} className={button}>
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Zurück
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)} className={button}>
          Weiter
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </nav>
  );
}
