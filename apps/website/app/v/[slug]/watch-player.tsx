"use client";

import { useCallback, useEffect, useRef } from "react";
import { ShinyButton } from "@/components/ui/shiny-button";

/**
 * Player + cookieless view tracking for eins.ag/v/<slug>.
 *
 * Beacons go straight to the portal as text/plain (a CORS "simple" request,
 * no preflight). Nothing is stored in the browser: the session id lives in
 * memory for this page load only. Progress is measured from the ranges the
 * viewer actually played (video.played), so scrubbing to the end does not
 * count as watching it.
 */

const MILESTONES = [10, 25, 50, 75, 90, 100] as const;

type Kind = "open" | "play" | "progress" | "cta";

function newSessionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function playedFraction(video: HTMLVideoElement): number {
  const d = video.duration;
  if (!Number.isFinite(d) || d <= 0) return 0;
  let seconds = 0;
  for (let i = 0; i < video.played.length; i++) {
    seconds += video.played.end(i) - video.played.start(i);
  }
  return Math.min(1, seconds / d);
}

interface WatchPlayerProps {
  slug: string;
  apiOrigin: string;
  videoUrl: string;
  posterUrl: string | null;
  contentType: string;
  calendlyUrl: string;
}

export function WatchPlayer({
  slug,
  apiOrigin,
  videoUrl,
  posterUrl,
  contentType,
  calendlyUrl,
}: WatchPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const session = useRef<string>("");
  const internal = useRef(false);
  const sent = useRef(new Set<string>());

  const send = useCallback(
    (k: Kind, p?: number) => {
      const id = `${k}:${p ?? 0}`;
      if (sent.current.has(id) || !session.current) return;
      sent.current.add(id);
      const body = JSON.stringify({
        k,
        s: session.current,
        ...(p !== undefined ? { p } : {}),
        ...(internal.current ? { i: true } : {}),
      });
      const url = `${apiOrigin}/api/public/videos/${slug}/events`;
      const blob = new Blob([body], { type: "text/plain" });
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(url, blob)) return;
      } catch {
        // fall through to fetch
      }
      void fetch(url, { method: "POST", body, keepalive: true, mode: "no-cors" }).catch(() => {});
    },
    [apiOrigin, slug]
  );

  useEffect(() => {
    // Ref guard: React strict mode runs this effect twice in dev.
    if (session.current) return;
    session.current = newSessionId();
    internal.current = new URLSearchParams(window.location.search).get("intern") === "1";
    send("open");
  }, [send]);

  const onProgress = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const pct = playedFraction(video) * 100;
    for (const m of MILESTONES) {
      // 100 % means "watched to the end", allowing for the last frames that
      // `played` never quite covers.
      const reached = m === 100 ? pct >= 97 : pct >= m;
      if (reached) send("progress", m);
    }
  }, [send]);

  return (
    <>
      <div className="mt-8 overflow-hidden rounded-2xl border border-border bg-black shadow-sm">
        <video
          ref={videoRef}
          controls
          playsInline
          preload="metadata"
          poster={posterUrl ?? undefined}
          className="aspect-video w-full"
          onPlay={() => send("play")}
          onTimeUpdate={onProgress}
          onEnded={onProgress}
          onPause={onProgress}
        >
          <source src={videoUrl} type={contentType === "video/quicktime" ? "video/mp4" : contentType} />
          Ihr Browser kann dieses Video nicht abspielen.
        </video>
      </div>

      <div className="card-glow mt-8 flex flex-col items-start gap-6 rounded-2xl border border-border bg-bg-secondary/60 p-6 backdrop-blur-sm md:flex-row md:items-center md:justify-between md:p-8">
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-tight md:text-3xl">
            Sprechen wir kurz darüber?
          </h2>
          <p className="mt-2 max-w-prose text-base text-fg-primary md:text-lg">
            30 Minuten, kostenlos. Wir gehen die Punkte aus dem Video für Ihre Praxis durch.
          </p>
        </div>
        <ShinyButton
          href={calendlyUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => send("cta")}
          className="shrink-0"
        >
          Gespräch vereinbaren
        </ShinyButton>
      </div>
    </>
  );
}
