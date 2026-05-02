"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
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

function ZoomLightbox({
  tab,
  onClose,
}: {
  tab: PortalTab;
  onClose: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fitSize, setFitSize] = useState<{ w: number; h: number } | null>(null);
  // Scale is relative to fit size: 1 = whole image visible, > 1 = zoomed in.
  // We render the image at fitSize * scale so the scroll container's
  // scrollWidth/Height grows naturally and native panning works.
  const [scale, setScale] = useState(1);

  // Compute fit-to-viewport size on open + viewport resize.
  useEffect(() => {
    const compute = () => {
      const vw = Math.max(0, window.innerWidth - LIGHTBOX_PAD * 2);
      const vh = Math.max(0, window.innerHeight - LIGHTBOX_PAD * 2);
      const aspect = tab.width / tab.height;
      const w = vw / vh > aspect ? vh * aspect : vw;
      const h = vw / vh > aspect ? vh : vw / aspect;
      setFitSize({ w, h });
    };
    compute();
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, [tab.width, tab.height]);

  const minScale = 1;
  const maxScale = fitSize
    ? Math.max(2, (tab.width / fitSize.w) * MAX_OVERZOOM)
    : 4;

  // When the scale changes, we want the point under the user's gesture
  // (cursor / pinch midpoint / button-press = viewport center) to stay put.
  // The sequence is: set the new scale via React state, then on the very
  // next layout, adjust scrollLeft/Top so the anchor point lines up again.
  const pendingAnchor = useRef<{
    imgX: number;
    imgY: number;
    screenX: number;
    screenY: number;
  } | null>(null);

  const setScaleAt = useCallback(
    (rawScale: number, anchorClientX?: number, anchorClientY?: number) => {
      const c = containerRef.current;
      if (!c) return;
      setScale((prev) => {
        const next = Math.max(minScale, Math.min(maxScale, rawScale));
        if (Math.abs(next - prev) < 0.001) return prev;
        const rect = c.getBoundingClientRect();
        const cx = anchorClientX ?? rect.left + rect.width / 2;
        const cy = anchorClientY ?? rect.top + rect.height / 2;
        const screenX = cx - rect.left;
        const screenY = cy - rect.top;
        pendingAnchor.current = {
          imgX: (c.scrollLeft + screenX) / prev,
          imgY: (c.scrollTop + screenY) / prev,
          screenX,
          screenY,
        };
        return next;
      });
    },
    [maxScale],
  );

  // Restore scroll anchor right after the new size paints. useLayoutEffect
  // runs after DOM update but before the browser paints, so the user sees
  // a single coherent frame instead of the image jumping then snapping.
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    const c = containerRef.current;
    if (a && c) {
      c.scrollLeft = a.imgX * scale - a.screenX;
      c.scrollTop = a.imgY * scale - a.screenY;
      pendingAnchor.current = null;
    }
  }, [scale]);

  // Initial centering: when fitSize first becomes available, center scroll
  // so the image (which is exactly viewport-fit) sits squarely in view.
  useLayoutEffect(() => {
    const c = containerRef.current;
    if (!c || !fitSize) return;
    c.scrollLeft = (c.scrollWidth - c.clientWidth) / 2;
    c.scrollTop = (c.scrollHeight - c.clientHeight) / 2;
  }, [fitSize]);

  // Wheel-to-zoom on desktop. We attach via ref + addEventListener with
  // {passive: false} because React's onWheel is passive in React 17+ and
  // can't preventDefault — without that the page scrolls instead of zooming.
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      // Trackpads on macOS report ctrlKey for pinch-to-zoom gestures; we
      // also accept plain wheel rotation since users expect that to zoom
      // inside an image viewer.
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setScaleAt(scale * factor, e.clientX, e.clientY);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [scale, setScaleAt]);

  // Pointer state — we track all active pointers so we can detect a
  // two-finger pinch. One finger = native scroll handles pan. Two fingers =
  // we drive the scale ourselves anchored to the midpoint between fingers.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ startDist: number; startScale: number } | null>(null);
  // Mouse drag-to-pan when zoomed in (touch devices use native scroll).
  const drag = useRef<{
    x: number;
    y: number;
    sl: number;
    st: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      // Second finger landed: cancel any drag and capture the pinch baseline.
      drag.current = null;
      const [p1, p2] = Array.from(pointers.current.values());
      pinch.current = {
        startDist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
        startScale: scale,
      };
      return;
    }
    if (e.pointerType === "mouse") {
      const c = containerRef.current;
      if (!c) return;
      drag.current = {
        x: e.clientX,
        y: e.clientY,
        sl: c.scrollLeft,
        st: c.scrollTop,
        moved: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Pointer capture is best-effort — synthesized events can reject ids.
      }
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
      setScaleAt(
        pinch.current.startScale * (dist / pinch.current.startDist),
        midX,
        midY,
      );
      return;
    }

    const d = drag.current;
    const c = containerRef.current;
    if (d && c) {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      if (!d.moved && Math.hypot(dx, dy) > 4) d.moved = true;
      c.scrollLeft = d.sl - dx;
      c.scrollTop = d.st - dy;
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
      // Defer clearing so the click handler that fires next can still see
      // the moved flag and suppress backdrop close after a drag.
      const wasMoved = drag.current.moved;
      drag.current = wasMoved
        ? { ...drag.current, x: 0, y: 0 } // keep `moved` true for the click
        : null;
      window.setTimeout(() => {
        drag.current = null;
      }, 0);
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (scale > 1.05) {
      setScaleAt(1);
    } else {
      setScaleAt(scale * ZOOM_STEP * 1.5, e.clientX, e.clientY);
    }
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

  const closeIfBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (drag.current?.moved) return; // click that finished a drag
    if (e.target === e.currentTarget) onClose();
  };

  if (!fitSize || typeof document === "undefined") return null;

  const imgW = fitSize.w * scale;
  const imgH = fitSize.h * scale;
  const canZoomIn = scale < maxScale - 0.01;
  const canZoomOut = scale > minScale + 0.01;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={tab.alt}
    >
      {/* Top-right control cluster: −, %, +, X. Stops propagation so clicks
          on the buttons never bubble to the backdrop close. */}
      <div
        className="absolute right-3 top-3 z-20 flex items-center gap-1.5 sm:right-4 sm:top-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => setScaleAt(scale / ZOOM_STEP)}
          disabled={!canZoomOut}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Verkleinern"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => setScale(1)}
          className="hidden h-10 min-w-[3.5rem] items-center justify-center rounded-full bg-black px-3 font-mono text-xs font-medium text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900 sm:inline-flex"
          aria-label="Auf Bildschirmgröße zurücksetzen"
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          type="button"
          onClick={() => setScaleAt(scale * ZOOM_STEP)}
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

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onClick={closeIfBackdrop}
        className="absolute inset-0 select-none overflow-auto overscroll-contain"
        style={{
          // pan-x pan-y lets the browser handle one-finger panning via
          // native scroll while still firing pointer events for our pinch
          // detection (two-finger gestures aren't covered by pan-* tokens
          // so they reach our handlers).
          touchAction: "pan-x pan-y",
          cursor:
            scale > 1
              ? drag.current
                ? "grabbing"
                : "grab"
              : canZoomIn
                ? "zoom-in"
                : "default",
        }}
      >
        <div
          onClick={(e) => {
            // Suppress the click that follows a drag so panning doesn't
            // accidentally trigger zoom or close.
            if (drag.current?.moved) {
              e.stopPropagation();
              return;
            }
            const onImage = (e.target as HTMLElement).tagName === "IMG";
            if (!onImage) {
              // Click on the dark margin around a fit-sized image —
              // standard lightbox UX is "click outside = close".
              onClose();
              return;
            }
            // Click on the image: zoom in one step at fit, no-op when
            // already zoomed (drag-pan handles interaction at that point).
            e.stopPropagation();
            if (scale <= 1.05 && canZoomIn) {
              setScaleAt(scale * ZOOM_STEP, e.clientX, e.clientY);
            }
          }}
          style={{
            width: imgW,
            height: imgH,
            // Center the image inside the container when it's smaller than
            // the viewport (i.e. at fit scale). When zoomed in, the wrapper
            // is larger than the container and these auto margins collapse.
            margin: "auto",
            minWidth: "100%",
            minHeight: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            src={tab.src}
            alt={tab.alt}
            width={tab.width}
            height={tab.height}
            // Drives Next.js to pick a srcset variant proportional to the
            // displayed size — zoom past the loaded variant and the browser
            // upgrades to a sharper one.
            sizes={`${Math.max(1, Math.round(imgW))}px`}
            priority
            draggable={false}
            decoding="async"
            style={{ width: imgW, height: imgH, maxWidth: "none" }}
            className="block select-none"
          />
        </div>
      </div>
    </div>,
    document.body,
  );
}
