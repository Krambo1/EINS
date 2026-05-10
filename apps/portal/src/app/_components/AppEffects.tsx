"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * Root-level client effects — currently just posts Core Web Vitals to
 * /api/vitals via sendBeacon so the metrics survive page unload. Mounted
 * once in the root layout. No PII in the payload — name/value/rating
 * plus the rendered route only.
 *
 * Why this file is named "AppEffects" and not the more descriptive
 * "WebVitalsReporter":
 *
 *   Browser ad/tracker/privacy blockers (uBlock Origin, Brave Shields,
 *   AdGuard, Privacy Badger, …) match request URLs against rule lists,
 *   and "WebVitals" in a script chunk path is a near-universal hit. When
 *   the chunk is blocked the network layer returns `(blocked:other)`,
 *   the module never executes, and React's hydration for this client
 *   component fails — which under React 19 + Next.js App Router takes
 *   the *entire* page's hydration down with it because this component
 *   sits at the root layout. The visible symptom: server-rendered HTML
 *   paints fine but nothing is interactive (toggles don't toggle, forms
 *   don't submit, links work only because they're native anchors).
 *
 *   Renaming the source file changes the emitted chunk's path, which
 *   sidesteps the filter without needing the user to disable their
 *   extension. The component still no-ops gracefully if the metrics
 *   endpoint itself is blocked, because navigator.sendBeacon and fetch
 *   failures here are swallowed.
 */
export function AppEffects() {
  useReportWebVitals((metric) => {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      id: metric.id,
      rating: metric.rating,
      route:
        typeof window === "undefined" ? "" : window.location.pathname,
    });

    if (
      typeof navigator !== "undefined" &&
      typeof navigator.sendBeacon === "function"
    ) {
      const blob = new Blob([body], { type: "application/json" });
      navigator.sendBeacon("/api/vitals", blob);
      return;
    }
    // Fallback for environments without sendBeacon — best effort, may drop on unload.
    fetch("/api/vitals", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
    }).catch(() => void 0);
  });

  return null;
}
