"use client";

import { useReportWebVitals } from "next/web-vitals";

/**
 * Posts Core Web Vitals to /api/vitals via sendBeacon so they survive unload.
 * Mounted once in the root layout. No PII in the payload — name/value/rating
 * plus the rendered route only.
 */
export function WebVitalsReporter() {
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
