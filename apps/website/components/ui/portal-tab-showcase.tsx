"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  FileText,
  BookOpen,
  X,
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

export function PortalTabShowcase() {
  const [active, setActive] = useState<string>(TABS[0].id);
  const [zoomed, setZoomed] = useState<PortalTab | null>(null);
  const current = TABS.find((t) => t.id === active) ?? TABS[0];

  // Each screenshot has a different aspect ratio (1.34 → 2.46), so the
  // container's height has to track the active image. We use the
  // padding-bottom percentage trick instead of CSS aspect-ratio because
  // padding-bottom is universally interpolatable, which gives us a smooth
  // height transition between tabs without JS measurement.
  const paddingBottom = `${(current.height / current.width) * 100}%`;

  return (
    <div className="w-full">
      <Tabs value={active} onValueChange={setActive}>
        <div className="flex justify-center">
          <div className="tabs-fade-mask w-full max-w-full overflow-x-auto md:w-auto md:overflow-visible md:[mask-image:none]">
            <TabsList className="px-1 md:px-1.5">
              {TABS.map(({ id, label, icon: Icon }) => (
                <TabsTrigger
                  key={id}
                  value={id}
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
          className="relative w-full overflow-hidden border border-border bg-bg-primary shadow-[0_2px_4px_rgba(16,16,26,0.06),0_18px_40px_-12px_rgba(16,16,26,0.18),0_40px_80px_-24px_rgba(88,186,181,0.18)] transition-[padding-bottom] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
          style={{ paddingBottom }}
        >
          {TABS.map((tab) => {
            const isActive = tab.id === active;
            return (
              <div
                key={tab.id}
                aria-hidden={!isActive}
                className="absolute inset-0 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ opacity: isActive ? 1 : 0 }}
              >
                <Image
                  src={tab.src}
                  alt={tab.alt}
                  width={tab.width}
                  height={tab.height}
                  sizes="(max-width: 768px) 100vw, (max-width: 1240px) 90vw, 1100px"
                  className="block h-full w-full object-contain object-top"
                  loading="eager"
                  unoptimized
                />
              </div>
            );
          })}
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

function ZoomLightbox({
  tab,
  onClose,
}: {
  tab: PortalTab;
  onClose: () => void;
}) {
  const [pan, setPan] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    panX: number;
    panY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const center = () => {
      setPan({
        x: (window.innerWidth - tab.width) / 2,
        y: (window.innerHeight - tab.height) / 2,
      });
    };
    center();
    window.addEventListener("resize", center);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("resize", center);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [tab, onClose]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pan) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture is best-effort — if the runtime rejects the id (e.g.
      // synthesized events in tests), fall back to global tracking via the
      // bubbled pointer events. The drag still works.
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = dragRef.current;
    if (!start) return;
    const dx = e.clientX - start.startX;
    const dy = e.clientY - start.startY;
    if (!start.moved && Math.hypot(dx, dy) > 4) start.moved = true;
    setPan({ x: start.panX + dx, y: start.panY + dy });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Releasing a non-captured pointer throws in some browsers — safe to ignore.
    }
    dragRef.current = null;
  };

  // Swallow the click that follows a real drag so the backdrop doesn't close.
  const onClickStage = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] overflow-hidden bg-black/85 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={tab.alt}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black text-white shadow-lg ring-1 ring-white/10 transition hover:bg-neutral-900"
        aria-label="Schließen"
      >
        <X className="h-5 w-5" />
      </button>
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/80 backdrop-blur"
      >
        Ziehen zum Bewegen · ESC zum Schließen
      </div>
      {pan && (
        <div
          className="absolute touch-none cursor-grab select-none active:cursor-grabbing"
          style={{
            left: pan.x,
            top: pan.y,
            width: tab.width,
            height: tab.height,
          }}
          onClick={onClickStage}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <Image
            src={tab.src}
            alt={tab.alt}
            width={tab.width}
            height={tab.height}
            sizes="100vw"
            className="pointer-events-none block h-full w-full"
            draggable={false}
            unoptimized
            priority
          />
        </div>
      )}
    </div>,
    document.body,
  );
}
