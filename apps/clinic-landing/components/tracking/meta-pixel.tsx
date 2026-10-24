"use client";

import * as React from "react";
import { useConsent } from "@/components/consent/consent-context";
import { drainTrackQueue, track } from "./track";

interface Props {
  pixelId: string;
}

/**
 * Meta Pixel — mounts ONLY after marketing consent.
 *
 * Initializes `window.fbq` with automatic collection OFF (no button texts,
 * page title/description or JSON-LD, which name the treatment; no automatic
 * advanced matching), fires exactly one standard PageView per page load with
 * a per-load event id, then drains queued events (track() lets only PageView
 * through to Meta). The page is statically built, so the id is generated in
 * the browser, never at build time.
 */
export function MetaPixel({ pixelId }: Props) {
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

    // Must run before init: stops the pixel reading button texts, page
    // metadata and JSON-LD. Automatic advanced matching stays off (no
    // user data passed to init).
    window.fbq?.("set", "autoConfig", false, pixelId);
    window.fbq?.("init", pixelId);
    track({ event: "PageView", eventId: pageViewId(), platforms: ["meta"] });
    drainTrackQueue();
  }, [consent.marketing, pixelId]);

  return null;
}

function pageViewId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `pv-${rand}`;
}
