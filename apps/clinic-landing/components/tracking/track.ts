/**
 * Tiny client-side tracking facade.
 *
 * - Adds events to a queue when the pixel libs aren't loaded yet
 * - Drops events entirely when marketing consent is missing
 * - Meta (fbq) only ever receives the standard `PageView`, without
 *   parameters. Custom events (QuizStart, QuizStep, ...) never reach fbq or
 *   the /api/track Meta relay: Meta restricts health advertisers and every
 *   extra field is health context. The Meta Lead is server-side only
 *   (/api/lead, consent + paid-Meta-visit gate).
 * - gtag / ttq get the non-Lead events; no treatment in any payload.
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

// No `treatment` field on purpose: nothing naming the treatment goes to an
// ad platform. EINS-internal RUM (/api/rum) is separate.
interface TrackPayload {
  step?: string;
  branch?: string;
  value?: number;
  currency?: string;
}

interface TrackArgs extends TrackPayload {
  event: EventName;
  /** Stable id the server will use to dedup against the CAPI side. */
  eventId: string;
  /**
   * When true, a PageView is also relayed to /api/track (Meta CAPI, same
   * event id for dedup). Only PageView is ever relayed. Default false.
   */
  serverRelay?: boolean;
  /**
   * Limit the fan-out to these pixels. Omitted = every loaded pixel. Meta
   * only ever takes a PageView, whatever this list says.
   */
  platforms?: ("meta" | "google" | "tiktok")[];
}

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
    ttq?: { track: (event: string, payload?: unknown, opts?: unknown) => void };
    __clinic_track_queue__?: TrackArgs[];
  }
}

export function track({ event, eventId, serverRelay = false, platforms, ...payload }: TrackArgs) {
  if (typeof window === "undefined") return;

  // Queue when no pixel is initialized yet. Drained from each pixel mount.
  if (typeof window.fbq !== "function" && typeof window.gtag !== "function") {
    window.__clinic_track_queue__ ||= [];
    window.__clinic_track_queue__.push({ event, eventId, serverRelay, platforms, ...payload });
    return;
  }

  const to = (p: "meta" | "google" | "tiktok") => !platforms || platforms.includes(p);

  // Meta: standard PageView only, no parameters. Everything else is dropped.
  const toMeta = event === "PageView" && to("meta");
  if (toMeta && typeof window.fbq === "function") {
    window.fbq("track", "PageView", undefined, { eventID: eventId });
  }

  if (to("google") && typeof window.gtag === "function") {
    window.gtag("event", event, { ...payload, transaction_id: eventId });
  }

  if (to("tiktok") && window.ttq && typeof window.ttq.track === "function") {
    window.ttq.track(event, payload, { event_id: eventId });
  }

  if (serverRelay && toMeta) {
    // Best-effort fire-and-forget. The relay accepts only PageView and sends
    // the origin only, no custom_data.
    void fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, eventId, sourceUrl: window.location.href }),
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
