"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { PAIN_QUOTES } from "@/lib/pain-quotes-data";

const AUTO_ADVANCE_MS = 3600;
const EASE_EXPO = "cubic-bezier(0.16, 1, 0.3, 1)";
const DRAG_THRESHOLD = 60;

export function Pains() {
  const total = PAIN_QUOTES.length;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const intervalRef = useRef<number | null>(null);
  const dragRef = useRef({ active: false, startX: 0, dx: 0, moved: false });
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const clearTimer = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    if (reduceMotion || paused || !inView || isDragging) return;
    intervalRef.current = window.setInterval(() => {
      setActive((a) => (a + 1) % total);
    }, AUTO_ADVANCE_MS);
  }, [clearTimer, total, reduceMotion, paused, inView, isDragging]);

  useEffect(() => {
    startTimer();
    return clearTimer;
  }, [startTimer, clearTimer]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const goTo = useCallback(
    (i: number) => {
      setActive(((i % total) + total) % total);
    },
    [total],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragRef.current = { active: true, startX: e.clientX, dx: 0, moved: false };
    setIsDragging(true);
    setDragDx(0);
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      // pointer no longer active (e.g. browser cancelled it before React fired)
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    dragRef.current.dx = dx;
    if (Math.abs(dx) > 4) dragRef.current.moved = true;
    setDragDx(dx);
  };

  const endDrag = (commit: boolean) => {
    if (!dragRef.current.active) return;
    const dx = dragRef.current.dx;
    dragRef.current = { ...dragRef.current, active: false };
    setIsDragging(false);
    setDragDx(0);
    if (commit && Math.abs(dx) > DRAG_THRESHOLD) {
      if (dx < 0) goTo(active + 1);
      else goTo(active - 1);
    }
  };

  const releaseCapture = (e: React.PointerEvent) => {
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture?.(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // pointer already released
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    releaseCapture(e);
    endDrag(true);
  };
  const onPointerCancel = (e: React.PointerEvent) => {
    releaseCapture(e);
    endDrag(false);
  };

  const cardWidth = isMobile ? 290 : 460;
  const cardHeight = isMobile ? 340 : 320;
  const tx = isMobile ? 200 : 330;
  const rotMax = isMobile ? 32 : 40;
  const tzStep = isMobile ? 140 : 200;
  const cardOffset = -cardWidth / 2;

  return (
    <section
      ref={sectionRef}
      id="pains"
      className="section relative pt-14 md:pt-24"
    >
      <div className="container">
        <Reveal delay={0.1}>
          <h2 className="display-l mx-auto max-w-5xl text-center">
            <span className="block">Kommt Ihnen das bekannt vor?</span>
            <span className="block">
              Es liegt <span className="text-accent">nicht an Ihnen.</span>
            </span>
          </h2>
        </Reveal>

        <Reveal delay={0.18}>
          <p className="mx-auto mt-6 max-w-2xl text-center font-mono text-base leading-relaxed text-fg-primary md:mt-8 md:text-lg">
            Fünf Sätze, die wir in fast jeder Erstberatung hören. Wortwörtlich.
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.24}>
        <div
          className="relative mt-4 w-full pb-10 pt-6 md:mt-6 md:pb-14 md:pt-8"
          style={{
            perspective: "2400px",
            overflowX: "clip",
            overflowY: "visible",
          }}
          aria-roledescription="carousel"
          aria-label="Aussagen aus der Erstberatung"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div
            className={`relative mx-auto select-none ${
              isDragging ? "cursor-grabbing" : "cursor-grab"
            }`}
            style={{
              height: cardHeight,
              transformStyle: "preserve-3d",
              touchAction: "pan-y",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {PAIN_QUOTES.map((q, i) => {
              let o = i - active;
              if (o > total / 2) o -= total;
              else if (o < -total / 2) o += total;
              const abs = Math.abs(o);
              const dir = o === 0 ? 0 : o > 0 ? 1 : -1;
              const isVisible = abs <= 1;
              const isCenter = o === 0;
              const translateX = o * tx + (isVisible ? dragDx : 0);
              const rotateY = -dir * Math.min(abs, 1) * rotMax;
              const translateZ = -abs * tzStep;
              const scale = abs === 0 ? 1 : 0.86;
              const opacity = !isVisible ? 0 : abs === 0 ? 1 : 0.6;

              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => {
                    if (dragRef.current.moved) {
                      dragRef.current.moved = false;
                      return;
                    }
                    if (!isCenter && isVisible) goTo(i);
                  }}
                  tabIndex={isVisible ? 0 : -1}
                  aria-hidden={!isVisible}
                  aria-label={isCenter ? undefined : `Zu Aussage ${i + 1} springen`}
                  aria-current={isCenter ? "true" : undefined}
                  className={`absolute top-0 left-1/2 box-border flex flex-col rounded-2xl border p-6 text-left backdrop-blur-md md:p-8 ${
                    isCenter
                      ? "border-[rgba(88,186,181,0.32)] bg-white/65 shadow-[0_1px_2px_rgba(16,16,26,0.05),0_18px_44px_-18px_rgba(16,16,26,0.22),0_36px_72px_-28px_rgba(16,16,26,0.28),0_0_0_1px_rgba(88,186,181,0.18)]"
                      : "border-[rgba(228,228,231,0.85)] bg-white/45 shadow-[0_14px_40px_-22px_rgba(16,16,26,0.22)]"
                  }`}
                  style={{
                    width: cardWidth,
                    height: cardHeight,
                    marginLeft: cardOffset,
                    transform: `translate3d(${translateX}px, 0, ${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`,
                    opacity,
                    zIndex: 100 - abs,
                    pointerEvents: isVisible ? "auto" : "none",
                    cursor: isCenter
                      ? isDragging
                        ? "grabbing"
                        : "grab"
                      : "pointer",
                    transition:
                      reduceMotion || isDragging
                        ? "none"
                        : `transform 480ms ${EASE_EXPO}, opacity 480ms ${EASE_EXPO}, box-shadow 480ms ${EASE_EXPO}`,
                  }}
                >
                  <div className="font-mono text-xs tracking-[0.08em] text-accent">
                    {String(q.id).padStart(2, "0")} · {q.chapter}
                  </div>
                  <p className="mt-2 font-display text-[1.4rem] font-medium italic leading-[1.18] text-fg-primary md:text-[1.625rem]">
                    „{q.quote}"
                  </p>
                  <p className="mt-3 text-[0.9rem] leading-[1.55] text-fg-secondary md:text-[0.95rem]">
                    {q.body}
                  </p>
                  <div className="mt-auto pt-4 font-mono text-[0.7rem] tracking-[0.06em] text-fg-tertiary">
                    {q.who} · {q.where}
                  </div>
                </button>
              );
            })}
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 z-[5] w-24 bg-gradient-to-r from-bg-primary to-transparent md:w-40"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 z-[5] w-24 bg-gradient-to-l from-bg-primary to-transparent md:w-40"
          />
        </div>
      </Reveal>

      <div className="container">
        <Reveal delay={0.28}>
          <div className="mt-8 flex items-center justify-center gap-3 font-mono text-[0.78rem] tracking-[0.06em] text-fg-tertiary md:mt-10">
            <button
              type="button"
              aria-label="zurück"
              onClick={() => goTo(active - 1)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-fg-primary transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden />
            </button>
            <span className="min-w-[64px] text-center">
              <b className="font-mono font-semibold text-fg-primary">
                {String(active + 1).padStart(2, "0")}
              </b>{" "}
              / {String(total).padStart(2, "0")}
            </span>
            <button
              type="button"
              aria-label="weiter"
              onClick={() => goTo(active + 1)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-white text-fg-primary transition-colors duration-200 hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
