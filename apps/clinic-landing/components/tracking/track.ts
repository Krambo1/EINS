/**
 * Tiny client-side tracking facade.
 *
 * - Adds events to a queue when the pixel libs aren't loaded yet
 * - Drops events entirely when marketing consent is missing
 * - Mirrors every event to /api/track for the server-side CAPI relay
 *
 * No external SDK — just `window.fbq`, `window.gtag`, `window.ttq` calls.
 * Each pixel adds itself to `window` only after consent + script load.
 */

type EventName =
  | "PageView"
  | "QuizStart"
  | "QuizStep"
  | "Lead"
  | "Contact"
  | "BookingComplete"
  | "ScrollDeep";

interface TrackPayload {
  step?: string;
  treatment?: string;
  branch?: string;
  value?: number;
  currency?: string;
}

interface TrackArgs extends TrackPayload {
  event: EventName;
  /** Stable id the server will use to dedup against the CAPI side. */
  eventId: string;
  /** When false, server-side relay is skipped (e.g. during scroll telemetry). */
  serverRelay?: boolean;
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    ttq?: { track: (event: string, payload?: unknown, opts?: unknown) => void };
    __clinic_track_queue__?: TrackArgs[];
  }
}

export function track({ event, eventId, serverRelay = true, ...payload }: TrackArgs) {
  if (typeof window === "undefined") return;

  // Queue when no pixel is initialized yet. Drained from each pixel mount.
  if (typeof window.fbq !== "function" && typeof window.gtag !== "function") {
    window.__clinic_track_queue__ ||= [];
    window.__clinic_track_queue__.push({ event, eventId, serverRelay, ...payload });
    return;
  }

  if (typeof window.fbq === "function") {
    window.fbq("trackCustom", event, payload, { eventID: eventId });
    if (event === "Lead") window.fbq("track", "Lead", payload, { eventID: eventId });
    if (event === "PageView") window.fbq("track", "PageView", undefined, { eventID: eventId });
  }

  if (typeof window.gtag === "function") {
    window.gtag("event", event, { ...payload, transaction_id: eventId });
  }

  if (window.ttq && typeof window.ttq.track === "function") {
    window.ttq.track(event, payload, { event_id: eventId });
  }

  if (serverRelay) {
    // Best-effort fire-and-forget. /api/track checks consent server-side too.
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, eventId, ...payload, sourceUrl: window.location.href }),
      keepalive: true,
    }).catch(() => {});
  }
}

export function drainTrackQueue() {
  if (typeof window === "undefined" || !window.__clinic_track_queue__) return;
  const q = window.__clinic_track_queue__;
  window.__clinic_track_queue__ = [];
  for (const item of q) track(item);
}
