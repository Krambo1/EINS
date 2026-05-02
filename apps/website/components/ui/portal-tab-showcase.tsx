"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  FileText,
  BookOpen,
  X,
  Plus,
  Minus,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PortalTab = {
  id: string;
  label: string;
  icon: LucideIcon;
  src: string;
  alt: string;
  width: number;
  height: number;
};

const TABS: PortalTab[] = [
  {
    id: "uebersicht",
    label: "Übersicht",
    icon: LayoutDashboard,
    src: "/Übersicht.png",
    alt: "EINS Portal Übersicht — Live-KPIs zu Anfragen, Umsatz und Tagesverlauf",
    width: 1528,
    height: 759,
  },
  {
    id: "anfragen",
    label: "Anfragen",
    icon: Inbox,
    src: "/Anfragen.png",
    alt: "EINS Portal Anfragen — Pipeline und Status jeder Patientenanfrage",
    width: 1552,
    height: 853,
  },
  {
    id: "auswertung",
    label: "Auswertung",
    icon: BarChart3,
    src: "/Auswertung.png",
    alt: "EINS Portal Auswertung — Conversion, ROI und Kanalvergleich",
    width: 1570,
    height: 982,
  },
  {
    id: "dokumente",
    label: "Dokumente",
    icon: FileText,
    src: "/Dokumente.png",
    alt: "EINS Portal Dokumente — Verträge, HWG-Checks und Reports an einem Ort",
    width: 1535,
    height: 623,
  },
  {
    id: "leitfaden",
    label: "Leitfaden",
    icon: BookOpen,
    src: "/Leitfaden (1).png",
    alt: "EINS Portal Vertriebsleitfaden — Gesprächsskripte für Ihr Team",
    width: 1534,
    height: 1146,
  },
];

const TRANSITION_MS = 250;

// Inject <link rel="preload"> once per src so subsequent tab switches feel
// instant. Browser fetches without decoding, then Next.js's <Image> reuses
// the cached response when the user actually opens that tab.
function preloadImage(src: string) {
  if (typeof document === "undefined") return;
  const id = `preload-${src}`;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "preload";
  link.as = "image";
  link.href = src;
  link.fetchPriority = "low";
  document.head.appendChild(link);
}

export function PortalTabShowcase() {
  const [activeId, setActiveId] = useState<string>(TABS[0].id);
  // Outgoing tab kept mounted for the 250ms crossfade then dropped, so we
  // never have more than two images decoded at once. The previous version
  // mounted all 5 simultaneously, which on mobile meant ~30MB of bitmap
  // memory and a perceptible lag during tab swaps.
  const [outgoingId, setOutgoingId] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<PortalTab | null>(null);

  const current = TABS.find((t) => t.id === activeId) ?? TABS[0];
  const outgoing = outgoingId
    ? TABS.find((t) => t.id === outgoingId) ?? null
    : null;

  const onTabChange = useCallback(
    (next: string) => {
      if (next === activeId) return;
      setOutgoingId(activeId);
      setActiveId(next);
    },
    [activeId],
  );

  // Drop the outgoing tab once the crossfade completes. Using a timer (vs.
  // onTransitionEnd) is robust against the user rapidly tab-hopping —
  // each new switch resets `outgoingId` to the previous tab anyway.
  useEffect(() => {
    if (!outgoingId) return;
    const t = window.setTimeout(() => setOutgoingId(null), TRANSITION_MS + 30);
    return () => window.clearTimeout(t);
  }, [outgoingId, activeId]);

  // Idle-prefetch the sibling tabs after first paint. Cheap on data
  // (the optimised AVIF variants are tiny) and removes the click-to-load
  // lag the first time a clinic clicks through tabs.
  useEffect(() => {
    const run = () => {
      for (const t of TABS) {
        if (t.id !== TABS[0].id) preloadImage(t.src);
      }
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof w.requestIdleCallback === "function") {
      const handle = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(handle);
    }
    const handle = window.setTimeout(run, 1500);
    return () => window.clearTimeout(handle);
  }, []);

  // Each screenshot has a different aspect ratio (1.34 → 2.46), so the
  // container's height has to track the active image. We use the
  // padding-bottom percentage trick instead of CSS aspect-ratio because
  // padding-bottom is universally interpolatable, which gives us a smooth
  // height transition between tabs.
  const paddingBottom = `${(current.height / current.width) * 100}%`;

  return (
    <div className="w-full">
      <Tabs value={activeId} onValueChange={onTabChange}>
        <div className="flex justify-center">
          <div className="tabs-fade-mask w-full max-w-full overflow-x-auto md:w-auto md:overflow-visible md:[mask-image:none]">
            <TabsList className="px-1 md:px-1.5">
              {TABS.map(({ id, label, icon: Icon, src }) => (
                <TabsTrigger
                  key={id}
                  value={id}
                  onPointerEnter={() => preloadImage(src)}
                  onFocus={() => preloadImage(src)}
                  className="shrink-0 gap-2 px-3.5 text-sm md:px-4 md:text-base"
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
      </Tabs>

      <div className="relative mt-8 md:mt-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-b from-accent/20 via-accent/5 to-transparent blur-2xl md:-inset-10"
        />
        <div
          className="relative w-full overflow-hidden border border-border bg-bg-primary shadow-[0_2px_4px_rgba(16,16,26,0.06),0_18px_40px_-12px_rgba(16,16,26,0.18),0_40px_80px_-24px_rgba(88,186,181,0.18)] transition-[padding-bottom] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ paddingBottom }}
        >
          {outgoing && outgoing.id !== current.id && (
            <ShowcaseImage key={outgoing.id} tab={outgoing} state="leaving" />
          )}
          <ShowcaseImage key={current.id} tab={current} state="entering" priority />

          <div className="group absolute inset-0">
            <button
              type="button"
              onClick={() => setZoomed(current)}
              className="absolute inset-0 cursor-zoom-in focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              aria-label={`${current.label} vergrößern`}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white shadow-lg ring-1 ring-white/10 backdrop-blur-sm transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105"
            >
              <ZoomIn className="h-3.5 w-3.5" aria-hidden />
              <span>Zum Vergrößern tippen</span>
            </div>
          </div>
        </div>
      </div>

      {zoomed && (
        <ZoomLightbox tab={zoomed} onClose={() => setZoomed(null)} />
      )}
    </div>
  );
}

// Active-tab image fades in on mount, outgoing fades out on next tick. Using
// a dedicated component keyed by tab id means React mounts/unmounts cleanly
// rather than reusing one element across tab changes, which would force a
// new image to start opaque without animating in.
function ShowcaseImage({
  tab,
  state,
  priority,
}: {
  tab: PortalTab;
  state: "entering" | "leaving";
  priority?: boolean;
}) {
  const [opacity, setOpacity] = useState(state === "entering" ? 0 : 1);

  useEffect(() => {
    // Ensure we start at 0/1 then schedule the target on the next frame so
    // the transition actually fires (setting both initial and target in the
    // same paint would skip the animation).
    const id = requestAnimationFrame(() => {
      setOpacity(state === "entering" ? 1 : 0);
    });
    return () => cancelAnimationFrame(id);
  }, [state]);

  return (
    <div
      aria-hidden={state === "leaving"}
      className="absolute inset-0 transition-opacity ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[opacity]"
      style={{ opacity, transitionDuration: `${TRANSITION_MS}ms` }}
    >
      <Image
        src={tab.src}
        alt={tab.alt}
        width={tab.width}
        height={tab.height}
        sizes="(max-width: 768px) 100vw, (max-width: 1240px) 90vw, 1100px"
        className="block h-full w-full object-contain object-top"
        priority={priority}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
      />
    </div>
  );
}

// Reserved padding around the image at fit-scale (1.0). Keeps the image
// clear of the top-right control cluster.
const LIGHTBOX_PAD = 16;
// User can keep zooming until the displayed image is 1.5x natural pixels —
// past that the AVIF starts to look mushy and there's nothing more to see.
const MAX_OVERZOOM = 1.5;
// Multiplier per +/- button click and per double-tap.
const ZOOM_STEP = 1.6;

// Transform-based zoom + pan. The image is loaded ONCE at the natural
// resolution and never resized — every zoom/pan update is a single
// `transform` write on a wrapper div. This is GPU-composited (no layout,
// no image refetch, no scroll thrash), which is the difference between
// chunky and smooth on every wheel/pinch tick.
function ZoomLightbox({
  tab,
  onClose,
}: {
  tab: PortalTab;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<{ w: number; h: number } | null>(
    null,
  );

  // Track the lightbox container size so fit math reacts to viewport
  // changes (rotation, mobile URL bar collapse, devtools opening).
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const update = () =>
      setContainer({ w: c.clientWidth, h: c.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Fit-to-container size at scale=1 (whole image visible with padding).
  const fit = useMemo(() => {
    if (!container) return null;
    const cw = Math.max(1, container.w - LIGHTBOX_PAD * 2);
    const ch = Math.max(1, container.h - LIGHTBOX_PAD * 2);
    const aspect = tab.width / tab.height;
    if (cw / ch > aspect) return { w: ch * aspect, h: ch };
    return { w: cw, h: cw / aspect };
  }, [container, tab.width, tab.height]);

  const minScale = 1;
  const maxScale = fit ? Math.max(2, (tab.width / fit.w) * MAX_OVERZOOM) : 4;

  // Transform state: scale + translation (px) of the image's center
  // relative to the container's center. (0,0) means perfectly centered.
  const [view, setView] = useState({ s: 1, tx: 0, ty: 0 });

  // Clamp translation so the image edges can't be dragged past the
  // viewport edges. When the image is smaller than the viewport (at
  // fit scale), it locks to centered.
  const clampView = useCallback(
    (s: number, tx: number, ty: number) => {
      if (!fit || !container) return { s, tx, ty };
      const w = fit.w * s;
      const h = fit.h * s;
      const maxTx = Math.max(0, (w - container.w) / 2);
      const maxTy = Math.max(0, (h - container.h) / 2);
      return {
        s,
        tx: Math.max(-maxTx, Math.min(maxTx, tx)),
        ty: Math.max(-maxTy, Math.min(maxTy, ty)),
      };
    },
    [fit, container],
  );

  // Apply a target scale anchored at a screen point. The math: with the
  // wrapper at the container's center and `transform: translate(tx,ty)
  // scale(s)`, an image-local point P projects to `tx + P*s` relative to
  // container center. To keep P under the cursor when scale changes, solve
  // for the new (tx', ty').
  const setScaleAt = useCallback(
    (rawScale: number, anchorClientX?: number, anchorClientY?: number) => {
      const c = containerRef.current;
      if (!c) return;
      setView((prev) => {
        const next = Math.max(minScale, Math.min(maxScale, rawScale));
        if (Math.abs(next - prev.s) < 0.0005) return prev;
        const rect = c.getBoundingClientRect();
        const cx =
          (anchorClientX ?? rect.left + rect.width / 2) - rect.left;
        const cy =
          (anchorClientY ?? rect.top + rect.height / 2) - rect.top;
        const dx = cx - rect.width / 2;
        const dy = cy - rect.height / 2;
        const px = (dx - prev.tx) / prev.s;
        const py = (dy - prev.ty) / prev.s;
        return clampView(next, dx - px * next, dy - py * next);
      });
    },
    [maxScale, clampView],
  );

  // Re-clamp translation if the viewport shrinks (e.g. window resize)
  // so an image already panned to an edge doesn't end up off-screen.
  useEffect(() => {
    setView((prev) => clampView(prev.s, prev.tx, prev.ty));
  }, [clampView]);

  // Wheel-to-zoom. addEventListener with {passive:false} because React's
  // onWheel is passive and can't preventDefault.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setScaleAt(view.s * factor, e.clientX, e.clientY);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [view.s, setScaleAt]);

  // Pointer / pinch / drag state.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{
    startDist: number;
    startScale: number;
    lastMid: { x: number; y: number };
  } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    tx: number;
    ty: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      drag.current = null;
      const [p1, p2] = Array.from(pointers.current.values());
      pinch.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
        startScale: view.s,
        lastMid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      };
      return;
    }
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      tx: view.tx,
      ty: view.ty,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort — synthesized ids can reject.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinch.current) {
      const [p1, p2] = Array.from(pointers.current.values());
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      // Pinch = zoom anchored at the new midpoint AND translate by the
      // midpoint delta so users can pan and zoom in one gesture. Both
      // updates fold into a single setView call so the anchor math is
      // computed against the freshly-translated state.
      const dxMid = midX - pinch.current.lastMid.x;
      const dyMid = midY - pinch.current.lastMid.y;
      pinch.current.lastMid = { x: midX, y: midY };
      const targetScale = Math.max(
        minScale,
        Math.min(
          maxScale,
          pinch.current.startScale * (dist / pinch.current.startDist),
        ),
      );
      setView((prev) => {
        const tx1 = prev.tx + dxMid;
        const ty1 = prev.ty + dyMid;
        const c = containerRef.current;
        if (!c || Math.abs(targetScale - prev.s) < 0.0005) {
          return clampView(prev.s, tx1, ty1);
        }
        const rect = c.getBoundingClientRect();
        const dx = midX - rect.left - rect.width / 2;
        const dy = midY - rect.top - rect.height / 2;
        const px = (dx - tx1) / prev.s;
        const py = (dy - ty1) / prev.s;
        return clampView(targetScale, dx - px * targetScale, dy - py * targetScale);
      });
      return;
    }

    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
      // Only pan when zoomed in — otherwise drag does nothing (and
      // single-finger touch slides on the fit image are no-ops, not jank).
      if (view.s > 1.001) {
        setView((prev) => clampView(prev.s, d.tx + dx, d.ty + dy));
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Releasing a non-captured pointer can throw — safe to ignore.
      }
      // Keep `moved` visible for the click handler that fires next, then
      // clear on the next tick.
      const wasMoved = drag.current.moved;
      drag.current = wasMoved ? { ...drag.current, x: 0, y: 0 } : null;
      window.setTimeout(() => {
        drag.current = null;
      }, 0);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (view.s > 1.05) setScaleAt(1);
    else setScaleAt(view.s * ZOOM_STEP * 1.5, e.clientX, e.clientY);
  };

  // ESC + body scroll lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  const canZoomIn = view.s < maxScale - 0.01;
  const canZoomOut = view.s > minScale + 0.01;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-[100] overflow-hidden bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={tab.alt}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onClick={(e) => {
        if (drag.current?.moved) return;
        // Background click (target = container itself) closes the lightbox.
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        // touchAction: none means we own all touch gestures (one-finger pan,
        // pinch, double-tap). Without this, mobile browsers swallow the
        // second touchpoint as page-zoom and our pinch handler never fires.
        touchAction: "none",
        cursor:
          view.s > 1
            ? drag.current
              ? "grabbing"
              : "grab"
            : canZoomIn
              ? "zoom-in"
              : "default",
      }}
    >
      {/* Top-right control cluster: −, %, +, X. Stops pointer events so
          button presses never start a drag or trigger background close. */}
      <div
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 sm:right-4 sm:top-4"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setScaleAt(view.s / ZOOM_STEP)}
          disabled={!canZoomOut}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Verkleinern"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setView({ s: 1, tx: 0, ty: 0 })}
          className="hidden h-10 min-w-[3.5rem] items-center justify-center rounded-full bg-black px-3 font-mono text-xs font-medium text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900 sm:inline-flex"
          aria-label="Auf Bildschirmgröße zurücksetzen"
        >
          {Math.round(view.s * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setScaleAt(view.s * ZOOM_STEP)}
          disabled={!canZoomIn}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Vergrößern"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900"
          aria-label="Schließen"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-white/10 px-3 py-1.5 text-center text-xs text-white/85 backdrop-blur"
      >
        Pinch · Doppeltippen · Scrollen · ESC
      </div>

      {fit && (
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 select-none"
          style={{
            width: fit.w,
            height: fit.h,
            // translate(-50%,-50%) anchors the wrapper at the container's
            // center; the second translate is our pan offset; scale then
            // grows around the wrapper's own center (transformOrigin).
            transform: `translate(-50%, -50%) translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
            transformOrigin: "center center",
            willChange: "transform",
          }}
          onClick={(e) => {
            if (drag.current?.moved) {
              e.stopPropagation();
              return;
            }
            e.stopPropagation();
            // Tap/click on the image at fit zoom = step in (matches the
            // "zoom-in" cursor we show in that state). When already zoomed,
            // taps do nothing — drag handles interaction.
            if (view.s <= 1.05 && canZoomIn) {
              setScaleAt(view.s * ZOOM_STEP, e.clientX, e.clientY);
            }
          }}
        >
          <Image
            src={tab.src}
            alt={tab.alt}
            width={tab.width}
            height={tab.height}
            // Constant — sized for the maximum zoom level so we never
            // refetch a different srcset variant during interaction.
            sizes={`${Math.round(tab.width * MAX_OVERZOOM)}px`}
            priority
            draggable={false}
            decoding="async"
            className="pointer-events-auto block h-full w-full select-none"
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
