"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";

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
  // Tracks native fullscreen so the video can switch object-cover → contain
  // (cover would crop the UI capture once the element fills the screen).
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  // Keep isFullscreen in sync with the browser. iOS Safari never fires
  // fullscreenchange for videos; it uses its own webkitbegin/endfullscreen
  // events on the element instead.
  useEffect(() => {
    const v = videoRef.current;
    const onChange = () =>
      setIsFullscreen(document.fullscreenElement === videoRef.current);
    const onBegin = () => setIsFullscreen(true);
    const onEnd = () => setIsFullscreen(false);
    document.addEventListener("fullscreenchange", onChange);
    v?.addEventListener("webkitbeginfullscreen", onBegin);
    v?.addEventListener("webkitendfullscreen", onEnd);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      v?.removeEventListener("webkitbeginfullscreen", onBegin);
      v?.removeEventListener("webkitendfullscreen", onEnd);
    };
  }, []);

  const enterFullscreen = () => {
    setActivated(true);
    const v = videoRef.current as
      | (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
      | null;
    if (!v) return;
    if (v.requestFullscreen) {
      v.requestFullscreen().catch(() => {});
    } else if (v.webkitEnterFullscreen) {
      // iOS Safari: only the video element itself can go fullscreen, via the
      // native player.
      v.webkitEnterFullscreen();
    }
    v.play().catch(() => {});
  };

  return (
    <div ref={containerRef} className="relative mt-8 md:mt-12">
      {/* Below md the frame runs edge-to-edge inside the offer card (the
          wrapper in offer.tsx pulls it out of the card padding), so side
          borders and rounding only exist from md up where a gutter remains. */}
      <div
        className="relative w-full overflow-hidden border-y border-border bg-bg-primary shadow-[0_2px_4px_rgba(16,16,26,0.06),0_18px_40px_-12px_rgba(16,16,26,0.18),0_40px_80px_-24px_rgba(88,186,181,0.18)] md:rounded-2xl md:border-x"
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
          className={`block h-full w-full ${isFullscreen ? "object-contain" : "object-cover object-top"}`}
        >
          {activated && <source src="/portal-showcase.mp4" type="video/mp4" />}
        </video>
        <button
          type="button"
          onClick={enterFullscreen}
          aria-label="Video im Vollbild ansehen"
          className="absolute bottom-2.5 right-2.5 z-10 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-xs text-white backdrop-blur-sm transition-colors md:bottom-4 md:right-4"
          style={{ background: "rgba(16,16,26,0.55)", border: "1px solid rgba(255,255,255,0.18)" }}
        >
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
          Vollbild
        </button>
      </div>
    </div>
  );
}
