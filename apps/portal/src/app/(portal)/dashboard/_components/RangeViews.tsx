"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@eins/ui";
import {
  DASHBOARD_RANGE_KEYS,
  parseDashboardRange,
  type DashboardRange,
} from "@/lib/dashboard-range";
import { loadDashboardRange } from "../range-actions";

/*
 * Client cache behind the dashboard's range switch.
 *
 * The page renders the period-dependent parts (RangeSlot "top" and "detail")
 * for the period in the URL. Every other period is rendered by the server
 * action `loadDashboardRange` and kept here, one view per period:
 *  - switching to a kept period swaps the view at once and only rewrites the
 *    URL (history.replaceState, no navigation, no scroll jump);
 *  - once the page has loaded, the other periods are loaded one by one while
 *    the browser is idle, so the first switch is instant too;
 *  - a view older than VIEW_TTL_MS is still shown at once and refreshed
 *    behind it, and the idle round runs again when the tab comes back.
 * Each view has the same element structure, so React updates the cards in
 * place and the numbers and bars ease to their new values.
 */

type Slot = "top" | "detail";

interface View {
  top: ReactNode;
  detail: ReactNode;
  /** When the server rendered it. */
  at: number;
}

/** A kept period older than this is shown at once and refreshed behind it. */
const VIEW_TTL_MS = 2 * 60_000;
/** Order of the idle preloading: the periods owners open most come first. */
const PRELOAD_ORDER: readonly DashboardRange[] = ["mon", "jahr", "heute", "max"];
/** A load that takes longer than this counts as failed. */
const LOAD_TIMEOUT_MS = 20_000;

/** Every per-card range param; the switch writes them all at once. */
const DASHBOARD_CARD_KEYS = Object.values(DASHBOARD_RANGE_KEYS);

/** The period all cards share; null when a deep link gives them different ones. */
function sharedRange(params: { get(name: string): string | null }): DashboardRange | null {
  const ranges = DASHBOARD_CARD_KEYS.map((key) => parseDashboardRange(params.get(key) ?? undefined));
  return ranges.every((r) => r === ranges[0]) ? ranges[0]! : null;
}

function rangeUrl(range: DashboardRange): string {
  const next = new URLSearchParams(window.location.search);
  for (const key of DASHBOARD_CARD_KEYS) next.set(key, range);
  return `${window.location.pathname}?${next.toString()}`;
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(() => resolve(), { timeout: 3000 });
    } else {
      window.setTimeout(resolve, 500);
    }
  });
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("timeout")), LOAD_TIMEOUT_MS);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

interface ServerView {
  range: DashboardRange | null;
  at: number;
}

interface RangeContextValue {
  /** The period in the URL. */
  urlRange: DashboardRange | null;
  /** The period the switch marks; follows a tap at once. */
  picked: DashboardRange | null;
  /** The period the cards show; trails `picked` while that view loads. */
  shown: DashboardRange | null;
  views: Partial<Record<DashboardRange, View>>;
  select: (range: DashboardRange) => void;
  reportServerView: (view: ServerView) => void;
}

const RangeContext = createContext<RangeContextValue | null>(null);

function useRangeContext(): RangeContextValue {
  const ctx = useContext(RangeContext);
  if (!ctx) throw new Error("DashboardRangeProvider fehlt");
  return ctx;
}

/** The period the switch marks and how to change it. */
export function useDashboardRange(): {
  picked: DashboardRange | null;
  loading: boolean;
  select: (range: DashboardRange) => void;
} {
  const { picked, shown, select } = useRangeContext();
  return { picked, loading: picked !== shown, select };
}

export function DashboardRangeProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const urlRange = sharedRange(useSearchParams());

  const [picked, setPicked] = useState(urlRange);
  const [shown, setShown] = useState(urlRange);
  const [views, setViews] = useState<Partial<Record<DashboardRange, View>>>({});
  const [server, setServer] = useState<ServerView | null>(null);
  const [round, setRound] = useState(0);

  // The URL changed without the switch (a link, back/forward): follow it.
  const [lastUrlRange, setLastUrlRange] = useState(urlRange);
  if (urlRange !== lastUrlRange) {
    setLastUrlRange(urlRange);
    if (urlRange !== picked) {
      setPicked(urlRange);
      setShown(urlRange);
    }
  }

  // Refs for the async paths, which must see the latest state.
  const pickedRef = useRef(picked);
  const viewsRef = useRef(views);
  const serverRef = useRef(server);
  useEffect(() => {
    pickedRef.current = picked;
    viewsRef.current = views;
    serverRef.current = server;
  });
  const inflight = useRef(new Map<DashboardRange, Promise<void>>());

  const load = useCallback(
    (range: DashboardRange): Promise<void> => {
      const running = inflight.current.get(range);
      if (running) return running;
      const task = withTimeout(loadDashboardRange(range))
        .then((result) => {
          startTransition(() => {
            setViews((prev) => ({ ...prev, [range]: { ...result, at: Date.now() } }));
            if (pickedRef.current === range) setShown(range);
          });
        })
        .catch(() => {
          // Still wanted: fall back to a normal navigation, the old path.
          if (pickedRef.current === range) router.replace(rangeUrl(range), { scroll: false });
        })
        .finally(() => {
          inflight.current.delete(range);
        });
      inflight.current.set(range, task);
      return task;
    },
    [router]
  );

  const select = useCallback(
    (range: DashboardRange) => {
      if (range === pickedRef.current) return;
      pickedRef.current = range;
      setPicked(range);
      window.history.replaceState(null, "", rangeUrl(range));

      const kept = viewsRef.current[range];
      const fromServer = serverRef.current?.range === range ? serverRef.current : null;
      const newest = Math.max(kept?.at ?? 0, fromServer?.at ?? 0);
      if (newest > 0) {
        startTransition(() => setShown(range));
        if (Date.now() - newest > VIEW_TTL_MS) void load(range);
      } else {
        void load(range);
      }
    },
    [load]
  );

  const reportServerView = useCallback((view: ServerView) => {
    setServer(view);
    // A server render for the period the switch marks (e.g. after the
    // fallback navigation) is what the cards should show.
    if (view.range === pickedRef.current) setShown(view.range);
  }, []);

  // Idle preloading: once the page's own view is on screen, load every other
  // period that is missing or stale, one at a time, while nothing else runs.
  useEffect(() => {
    if (!server) return;
    let cancelled = false;
    void (async () => {
      for (const range of PRELOAD_ORDER) {
        const fresh = Math.max(
          viewsRef.current[range]?.at ?? 0,
          serverRef.current?.range === range ? serverRef.current.at : 0
        );
        if (Date.now() - fresh < VIEW_TTL_MS) continue;
        await whenIdle();
        if (cancelled || document.hidden) return;
        await load(range);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `server` only gates the first round; later rounds come from `round`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server !== null, round, load]);

  // Back in the tab: refresh whatever went stale meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setRound((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const value = useMemo<RangeContextValue>(
    () => ({ urlRange, picked, shown, views, select, reportServerView }),
    [urlRange, picked, shown, views, select, reportServerView]
  );
  return <RangeContext.Provider value={value}>{children}</RangeContext.Provider>;
}

/**
 * One period-dependent part of the page. `children` is the server render for
 * the period in the URL; a kept view for the shown period wins when it is
 * newer. While a picked period is still loading, the last view stays up,
 * dimmed.
 */
export function RangeSlot({ slot, children }: { slot: Slot; children: ReactNode }) {
  const { urlRange, shown, picked, views, reportServerView } = useRangeContext();

  // Which period the server render is for: the URL's when it arrived.
  const [snap, setSnap] = useState(() => ({ node: children, range: urlRange, at: Date.now() }));
  if (snap.node !== children) setSnap({ node: children, range: urlRange, at: Date.now() });

  useEffect(() => {
    if (slot === "top") reportServerView({ range: snap.range, at: snap.at });
  }, [slot, snap, reportServerView]);

  const kept = shown ? views[shown] : undefined;
  const serverFits = shown === snap.range;
  const node =
    kept && (!serverFits || kept.at > snap.at) ? kept[slot] : serverFits ? snap.node : undefined;

  // While nothing fits (the picked period is loading), keep the last view.
  const last = useRef<ReactNode>(snap.node);
  useEffect(() => {
    if (node !== undefined) last.current = node;
  }, [node]);

  // Dimmed only after a beat: a kept view swaps in within a frame and should
  // not flicker. The detail bundle is a fragment of cards, so the slot keeps
  // the page's spacing step between them.
  const loading = picked !== shown;
  return (
    <div
      aria-busy={loading}
      className={cn(
        "space-y-4 transition-opacity duration-200 md:space-y-6",
        loading && "opacity-60 delay-150"
      )}
    >
      {node ?? last.current}
    </div>
  );
}
