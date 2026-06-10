"use client";

import { useEffect, useRef, useState } from "react";

// Intrinsic dimensions of the encoded clip. Drives the aspect-ratio box so the
// frame reserves the right height before the video streams in (no layout
// shift). Confirmed against the transcoded file.
const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;

// A muted, looping silent clip of the EINS portal. Lazy: the page loads only
// the tiny poster frame; the 2.1 MB MP4 is not fetched until the section
// scrolls near the viewport (preload="none" + source mounted on demand), and
// playback pauses when it scrolls back out so it never burns CPU off-screen.
// This keeps the video off the critical path entirely — initial load is
// unaffected. Replaces the old PortalTabShowcase visual; the heading, copy and
// card framing around it stay in offer.tsx.
export function PortalVideoShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Once true the <source>s mount and we never tear them down again — toggling
  // them would re-fetch the file on every scroll in/out.
  const [activated, setActivated] = useState(false);

  // Activate (start fetching + playing) when the frame enters the viewport;
  // pause when it fully leaves. A 200px rootMargin gives the file a head start
  // so it is usually playing by the time it is actually on screen.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setActivated(true);
          if (!reducedMotion) {
            videoRef.current?.play().catch(() => {
              // Autoplay can be blocked; the poster stays as a graceful
              // fallback and the loop simply does not start.
            });
          }
        } else {
          videoRef.current?.pause();
        }
      },
      { rootMargin: "200px 0px", threshold: 0.01 },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  // When the sources first mount, tell the element to (re)load them, then play.
  useEffect(() => {
    if (!activated) return;
    const v = videoRef.current;
    if (!v) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    v.load();
    if (!reducedMotion) {
      v.play().catch(() => {});
    }
  }, [activated]);

  return (
    <div ref={containerRef} className="relative mt-8 md:mt-12">
      {/* Hot mint band hugging the top edge, matching the old screenshot frame
          (.portal-glow in globals.css). */}
      <div
        aria-hidden
        className="portal-glow pointer-events-none absolute -top-24 left-1/2 -z-10 h-24 w-[78%] blur-xl md:-top-28 md:h-28 md:w-[72%] md:blur-2xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-b from-accent/20 via-accent/5 to-transparent blur-2xl md:-inset-10"
      />
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-border bg-bg-primary shadow-[0_2px_4px_rgba(16,16,26,0.06),0_18px_40px_-12px_rgba(16,16,26,0.18),0_40px_80px_-24px_rgba(88,186,181,0.18)]"
        style={{ aspectRatio: `${VIDEO_WIDTH} / ${VIDEO_HEIGHT}` }}
      >
        <video
          ref={videoRef}
          poster="/portal-showcase-poster.webp"
          width={VIDEO_WIDTH}
          height={VIDEO_HEIGHT}
          muted
          loop
          playsInline
          preload="none"
          aria-label="EINS Portal in Bewegung: Anfragen, Werbebudget und Umsatz auf einen Blick"
          className="block h-full w-full object-cover object-top"
        >
          {activated && <source src="/portal-showcase.mp4" type="video/mp4" />}
        </video>
      </div>
    </div>
  );
}
