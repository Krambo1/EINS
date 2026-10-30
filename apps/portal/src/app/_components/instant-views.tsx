"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { cn } from "@eins/ui";

/*
 * Instant view switches (DESIGN.md section 10, "A view switch is instant").
 *
 * A tab, period, filter or page that lives in the address must not wait for
 * a server render of the whole route. Three tools:
 *
 *  - setSearchParams: rewrites the address with history.replaceState. No
 *    navigation, no scroll jump; Next keeps useSearchParams in sync, so a
 *    component that reads its state from the address updates at once, and a
 *    reload or a shared link opens the same view. For bounded data (the
 *    server sends every row once, the browser filters).
 *  - ParamViews: one view per value of a param (tab, period). The server
 *    renders the value in the address; every other value comes from a server
 *    action and is kept, and the others load one by one while the browser is
 *    idle. The generalised period switch of the dashboard (RangeViews.tsx).
 *  - NavTransition: for unbounded data the server still filters, but the
 *    controls show the new value at once and the old rows dim at the same
 *    size until the new ones arrive.
 */

// ---------------------------------------------------------------------------
// Address
// ---------------------------------------------------------------------------

type ParamChanges = Record<string, string | readonly string[] | null | undefined>;

/** The current address with `changes` applied (empty values drop the key). */
export function searchParamsUrl(changes: ParamChanges, opts: { only?: boolean } = {}): string {
  const q = new URLSearchParams(opts.only ? "" : window.location.search);
  for (const [key, value] of Object.entries(changes)) {
    q.delete(key);
    if (value == null || value === "") continue;
    if (typeof value === "string") q.set(key, value);
    else for (const v of value) q.append(key, v);
  }
  const s = q.toString();
  return s ? `${window.location.pathname}?${s}` : window.location.pathname;
}

/**
 * Rewrites search params without a navigation. `only` drops every param not
 * named in `changes` (a tab switch resets the tab's deep-link state).
 */
export function setSearchParams(changes: ParamChanges, opts: { only?: boolean } = {}): void {
  window.history.replaceState(null, "", searchParamsUrl(changes, opts));
}

// ---------------------------------------------------------------------------
// ParamViews
// ---------------------------------------------------------------------------

interface KeptView {
  node: ReactNode;
  /** When the server rendered it. */
  at: number;
}

/** A kept view older than this is shown at once and refreshed behind it. */
const VIEW_TTL_MS = 2 * 60_000;
/** A load that takes longer than this counts as failed. */
const LOAD_TIMEOUT_MS = 20_000;

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

interface ServerSnap extends KeptView {
  /** The value the server rendered. */
  value: string;
  /** The search params of the address it was rendered for. */
  search: string;
}

interface ParamViewsValue {
  param: string;
  only: boolean;
  /** The value the controls mark; follows a tap at once. */
  picked: string;
  /** The value the slot shows; trails `picked` while that view loads. */
  shown: string;
  /** One view per value: loaded ones and clean server renders. */
  views: Partial<Record<string, KeptView>>;
  select: (value: string) => void;
  reportServer: (snap: ServerSnap) => void;
}

const ParamViewsContext = createContext<ReadonlyMap<string, ParamViewsValue>>(new Map());

/** The view switch for `param` around this component, or null outside one. */
export function useParamViews(param: string): { picked: string; loading: boolean; select: (value: string) => void } | null {
  const ctx = useContext(ParamViewsContext).get(param);
  if (!ctx) return null;
  return { picked: ctx.picked, loading: ctx.picked !== ctx.shown, select: ctx.select };
}

/**
 * Keeps one view per value of the search param `param`. Put the controls and
 * a ParamViewsSlot (with the server render for the value in the address)
 * inside it. Controls call `useParamViews(param).select`.
 */
export function ParamViews({
  param,
  values,
  defaultValue,
  load,
  preload = values,
  only = false,
  children,
}: {
  param: string;
  /** Every value the param can take; anything else reads as `defaultValue`. */
  values: readonly string[];
  /** The value without the param in the address (it is left out there). */
  defaultValue: string;
  /** Server action rendering the view for one value (with no other params). */
  load: (value: string) => Promise<ReactNode>;
  /** Values to load while the browser is idle, in this order. */
  preload?: readonly string[];
  /**
   * A switch drops every other param (a tab resets its filters and pages).
   * A server render with other params then only stands for its own address.
   */
  only?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const read = useCallback(
    (raw: string | null) => (raw && values.includes(raw) ? raw : defaultValue),
    [values, defaultValue]
  );
  const urlValue = read(useSearchParams().get(param));

  const [picked, setPicked] = useState(urlValue);
  const [shown, setShown] = useState(urlValue);
  const [views, setViews] = useState<Partial<Record<string, KeptView>>>({});
  const [ready, setReady] = useState(false);
  const [round, setRound] = useState(0);

  // The address changed without the switch (a link, back/forward): follow it.
  const [lastUrlValue, setLastUrlValue] = useState(urlValue);
  if (urlValue !== lastUrlValue) {
    setLastUrlValue(urlValue);
    if (urlValue !== picked) {
      setPicked(urlValue);
      setShown(urlValue);
    }
  }

  // Refs for the async paths, which must see the latest state.
  const pickedRef = useRef(picked);
  const viewsRef = useRef(views);
  useEffect(() => {
    pickedRef.current = picked;
    viewsRef.current = views;
  });
  const inflight = useRef(new Map<string, Promise<void>>());

  const urlFor = useCallback(
    (value: string) => searchParamsUrl({ [param]: value === defaultValue ? null : value }, { only }),
    [param, defaultValue, only]
  );

  const keep = useCallback((value: string, view: KeptView) => {
    setViews((prev) => ((prev[value]?.at ?? 0) >= view.at ? prev : { ...prev, [value]: view }));
  }, []);

  const fetchView = useCallback(
    (value: string): Promise<void> => {
      const running = inflight.current.get(value);
      if (running) return running;
      const task = withTimeout(load(value))
        .then((node) => {
          startTransition(() => {
            keep(value, { node, at: Date.now() });
            if (pickedRef.current === value) setShown(value);
          });
        })
        .catch(() => {
          // Still wanted: fall back to a normal navigation.
          if (pickedRef.current === value) router.replace(urlFor(value), { scroll: false });
        })
        .finally(() => {
          inflight.current.delete(value);
        });
      inflight.current.set(value, task);
      return task;
    },
    [load, keep, router, urlFor]
  );

  const select = useCallback(
    (value: string) => {
      if (value === pickedRef.current) return;
      pickedRef.current = value;
      setPicked(value);
      window.history.replaceState(null, "", urlFor(value));

      const kept = viewsRef.current[value];
      if (kept) {
        startTransition(() => setShown(value));
        if (Date.now() - kept.at > VIEW_TTL_MS) void fetchView(value);
      } else {
        void fetchView(value);
      }
    },
    [fetchView, urlFor]
  );

  const reportServer = useCallback(
    (snap: ServerSnap) => {
      setReady(true);
      // A render with params of its own (a filter, a page) is only kept for
      // its own address; with `only` a switch never comes back to it.
      const clean =
        !only || new URL(urlFor(snap.value), window.location.origin).search.slice(1) === snap.search;
      if (clean) keep(snap.value, { node: snap.node, at: snap.at });
      if (snap.value === pickedRef.current) setShown(snap.value);
    },
    [only, urlFor, keep]
  );

  // Idle preloading: once the page's own view is on screen, load every other
  // value that is missing or stale, one at a time.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      for (const value of preload) {
        if (Date.now() - (viewsRef.current[value]?.at ?? 0) < VIEW_TTL_MS) continue;
        await whenIdle();
        if (cancelled || document.hidden) return;
        await fetchView(value);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `ready` only gates the first round; later rounds come from `round`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, round, fetchView]);

  // Back in the tab: refresh whatever went stale meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") setRound((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const outer = useContext(ParamViewsContext);
  const value = useMemo(() => {
    const next = new Map(outer);
    next.set(param, { param, only, picked, shown, views, select, reportServer });
    return next;
  }, [outer, param, only, picked, shown, views, select, reportServer]);
  return <ParamViewsContext.Provider value={value}>{children}</ParamViewsContext.Provider>;
}

/**
 * The part of the page that changes with `param`. `children` is the server
 * render for `value`; a kept view for the shown value wins when it is newer.
 * While a picked value still loads, the last view stays up, dimmed after a
 * beat, at the same size.
 */
export function ParamViewsSlot({
  param,
  value,
  className,
  children,
}: {
  param: string;
  /** The value `children` was rendered for. */
  value: string;
  className?: string;
  children: ReactNode;
}) {
  const ctx = useContext(ParamViewsContext).get(param);
  if (!ctx) throw new Error(`ParamViews für "${param}" fehlt`);
  const { only, shown, picked, views, reportServer } = ctx;
  const search = useSearchParams().toString();

  const [snap, setSnap] = useState<ServerSnap>(() => ({ node: children, value, at: Date.now(), search }));
  if (snap.node !== children) setSnap({ node: children, value, at: Date.now(), search });

  useEffect(() => {
    reportServer(snap);
  }, [snap, reportServer]);

  const kept = views[shown];
  // With `only`, the server render fits only the address it was made for.
  const serverFits = shown === snap.value && (!only || snap.search === search);
  const node =
    kept && (!serverFits || kept.at > snap.at) ? kept.node : serverFits ? snap.node : undefined;

  // While nothing fits (the picked value is loading), keep the last view.
  const last = useRef<ReactNode>(snap.node);
  useEffect(() => {
    if (node !== undefined) last.current = node;
  }, [node]);

  const loading = picked !== shown || node === undefined;
  return (
    <div
      aria-busy={loading}
      className={cn("transition-opacity duration-200", loading && "opacity-60 delay-150", className)}
    >
      {node ?? last.current}
    </div>
  );
}

/**
 * A link to one value of `param`. Inside ParamViews for `param` a plain click
 * switches at once; a modified click (new tab) and use outside ParamViews
 * stay a normal link to the same address.
 */
export function ParamLink({
  param,
  value,
  href,
  onClick,
  className,
  activeClassName,
  inactiveClassName,
  ...rest
}: Omit<ComponentProps<typeof Link>, "href"> & {
  param: string;
  value: string;
  href: string;
  /** Added while this value is the picked one. */
  activeClassName?: string;
  /** Added while it is not. */
  inactiveClassName?: string;
}) {
  const views = useParamViews(param);
  const active = views?.picked === value;
  return (
    <Link
      {...rest}
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(className, active ? activeClassName : inactiveClassName)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (!views || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        views.select(value);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// NavTransition (unbounded data: server filter, instant feedback)
// ---------------------------------------------------------------------------

interface NavTransitionValue {
  /** The address the controls should show: the target while it loads. */
  params: URLSearchParams;
  pending: boolean;
  /** Navigates to the address with `changes` applied, inside a transition. */
  navigate: (changes: ParamChanges | ((params: URLSearchParams) => void)) => void;
}

const NavTransitionContext = createContext<NavTransitionValue | null>(null);

/** The pending navigation around this component, or null outside one. */
export function useNavTransition(): NavTransitionValue | null {
  return useContext(NavTransitionContext);
}

/**
 * Wraps a list whose filters, sort and pages the server applies. A control
 * calls `navigate`: the address and the controls switch at once (the
 * optimistic params), the server render follows in a transition, and
 * PendingDim dims the old rows at the same size meanwhile.
 */
export function NavTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const urlParams = useSearchParams();
  const [pending, start] = useTransition();
  const [params, setParams] = useOptimistic(
    useMemo(() => new URLSearchParams(urlParams.toString()), [urlParams])
  );

  const navigate = useCallback<NavTransitionValue["navigate"]>(
    (changes) => {
      // From the target of a change still loading, so two quick changes add up.
      const next = new URLSearchParams(params.toString());
      if (typeof changes === "function") changes(next);
      else {
        for (const [key, value] of Object.entries(changes)) {
          next.delete(key);
          if (value == null || value === "") continue;
          if (typeof value === "string") next.set(key, value);
          else for (const v of value) next.append(key, v);
        }
      }
      const s = next.toString();
      start(() => {
        setParams(next);
        router.replace(s ? `${window.location.pathname}?${s}` : window.location.pathname, { scroll: false });
      });
    },
    [router, params, setParams]
  );

  const value = useMemo(() => ({ params, pending, navigate }), [params, pending, navigate]);
  return <NavTransitionContext.Provider value={value}>{children}</NavTransitionContext.Provider>;
}

/** The rows of a NavTransition list: dimmed at the same size while a change loads. */
export function PendingDim({ className, children }: { className?: string; children: ReactNode }) {
  const pending = useNavTransition()?.pending ?? false;
  return (
    <div
      aria-busy={pending}
      className={cn("transition-opacity duration-200", pending && "opacity-60 delay-150", className)}
    >
      {children}
    </div>
  );
}

/**
 * A GET filter form of a NavTransition list: submitting navigates in the
 * transition (the rows dim at once) with exactly the form's fields, like the
 * browser's own GET submit, which stays the path without JavaScript.
 */
export function NavForm({ onSubmit, ...rest }: ComponentProps<"form">) {
  const nav = useNavTransition();
  return (
    <form
      {...rest}
      method="get"
      onSubmit={(e) => {
        onSubmit?.(e);
        if (!nav || e.defaultPrevented) return;
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        nav.navigate((p) => {
          for (const key of Array.from(p.keys())) p.delete(key);
          for (const [key, value] of data.entries()) {
            if (typeof value === "string" && value !== "") p.append(key, value);
          }
        });
      }}
    />
  );
}

/**
 * The value of `param` the controls should show: inside NavTransition the
 * target of a navigation still loading, else the address.
 */
export function usePendingParam(param: string, defaultValue = ""): string {
  const nav = useNavTransition();
  const url = useSearchParams();
  return (nav ? nav.params.get(param) : url.get(param)) ?? defaultValue;
}

/**
 * A link to another page of the same list (pager, sort, tab). Inside
 * NavTransition it navigates in the transition, so the rows dim at once; a
 * modified click stays a normal link. With `param` and `value` it marks
 * itself (`aria-current`, `activeClassName`) from the target address, so a
 * tab or period shows as picked on the tap.
 */
export function PendingLink({
  href,
  onClick,
  className,
  param,
  value,
  defaultValue,
  activeClassName,
  inactiveClassName,
  ...rest
}: ComponentProps<typeof Link> & {
  href: string;
  param?: string;
  value?: string;
  /** The value of `param` when the address has none. */
  defaultValue?: string;
  activeClassName?: string;
  inactiveClassName?: string;
}) {
  const nav = useNavTransition();
  const current = usePendingParam(param ?? "", defaultValue);
  const active = param != null && current === value;
  return (
    <Link
      {...rest}
      href={href}
      scroll={false}
      aria-current={param != null && active ? "page" : undefined}
      className={param != null ? cn(className, active ? activeClassName : inactiveClassName) : className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (!nav || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const target = new URL(href, window.location.href);
        nav.navigate((p) => {
          for (const key of Array.from(p.keys())) p.delete(key);
          target.searchParams.forEach((v, k) => p.append(k, v));
        });
      }}
    />
  );
}

/**
 * The page number of a NavTransition pager ("Seite 2 von 4"): the target page
 * on the tap, so the label answers before the rows arrive. Read like the
 * server reads it: anything but a whole number from 1 is page 1.
 */
export function PendingPage({ param = "page" }: { param?: string }) {
  const n = Number(usePendingParam(param, "1"));
  return <>{Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1}</>;
}

/** Where the last link click in a PagerNav was on screen, until its next page shows. */
let pagerClick: { anchor: string; top: number; at: number } | null = null;

/**
 * The nav of a pager that stays where it was on screen when the page changes.
 * Content above it that differs between pages (cards only on the first page,
 * rows that wrap) would otherwise move "Zurück" and "Weiter" away from the
 * pointer (DESIGN.md section 10, "A pager shows both buttons on every page").
 */
export function PagerNav({
  anchor,
  page,
  onClickCapture,
  ...rest
}: ComponentProps<"nav"> & {
  /** Names the pager, so only its own next page scrolls. */
  anchor: string;
  /** The page shown; the nav moves back into place when it changes. */
  page: number;
}) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const click = pagerClick;
    const el = ref.current;
    if (!click || click.anchor !== anchor || !el || Date.now() - click.at > 10_000) return;
    pagerClick = null;
    const delta = el.getBoundingClientRect().top - click.top;
    if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
  }, [anchor, page]);
  return (
    <nav
      {...rest}
      ref={ref}
      onClickCapture={(e) => {
        onClickCapture?.(e);
        // A plain click on a link only: a greyed-out button or a new tab
        // changes no page here.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!(e.target as Element).closest("a[href]") || !ref.current) return;
        pagerClick = { anchor, top: ref.current.getBoundingClientRect().top, at: Date.now() };
      }}
    />
  );
}
