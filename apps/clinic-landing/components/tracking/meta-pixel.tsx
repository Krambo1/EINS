"use client";

import * as React from "react";
import { useConsent } from "@/components/consent/consent-context";
import { drainTrackQueue, track } from "./track";

interface Props {
  pixelId: string;
  /** Used as the event_id for the initial PageView (matches CAPI server-side). */
  pageViewEventId: string;
}

/**
 * Meta Pixel — mounts ONLY after marketing consent.
 *
 * Initializes `window.fbq`, fires the standard PageView with the dedup id, then
 * drains any queued events that fired before consent was granted.
 */
export function MetaPixel({ pixelId, pageViewEventId }: Props) {
  const consent = useConsent();
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (!consent.marketing || initialized.current) return;
    initialized.current = true;

    // Inline pixel bootstrap — copied straight from Meta's docs, minus the
    // privacy-hostile bits (we don't enable First-Party Cookie attribution
    // beyond what the user opted into).
    /* eslint-disable */
    (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = "2.0";
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */

    window.fbq?.("init", pixelId);
    window.fbq?.("track", "PageView", undefined, { eventID: pageViewEventId });
    drainTrackQueue();
  }, [consent.marketing, pixelId, pageViewEventId]);

  // Re-fire PageView on route changes (App Router) — not strictly needed for a
  // single landing page, but keeps the pixel honest if we add internal nav later.
  React.useEffect(() => {
    if (!consent.marketing) return;
    track({ event: "PageView", eventId: pageViewEventId, serverRelay: false });
  }, [consent.marketing, pageViewEventId]);

  return null;
}
