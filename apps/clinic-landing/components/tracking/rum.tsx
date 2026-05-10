"use client";

import * as React from "react";
import { useConsent } from "@/components/consent/consent-context";

/**
 * First-party Web-Vitals reporter.
 *
 * Uses the native PerformanceObserver — no `web-vitals` library, no extra KB.
 * Only sends LCP, CLS, INP and TTFB. Sent via sendBeacon so it doesn't slow
 * unload. Gated by Statistik consent.
 */
export function RumReporter({ clinicSlug, treatmentSlug }: { clinicSlug: string; treatmentSlug: string }) {
  const consent = useConsent();
  const sentRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (!consent.statistik) return;

    const send = (name: string, value: number) => {
      if (sentRef.current.has(name)) return;
      sentRef.current.add(name);
      const body = JSON.stringify({
        name,
        value,
        clinic: clinicSlug,
        treatment: treatmentSlug,
        url: window.location.pathname,
        ua: navigator.userAgent,
        connection: (navigator as any).connection?.effectiveType,
      });
      try {
        if (navigator.sendBeacon) navigator.sendBeacon("/api/rum", body);
        else void fetch("/api/rum", { method: "POST", body, keepalive: true });
      } catch {
        // ignore
      }
    };

    let cls = 0;
    const reportCls = () => send("CLS", Math.round(cls * 1000) / 1000);

    try {
      // LCP — last reported entry wins
      new PerformanceObserver((list) => {
        const entries = list.getEntries() as PerformanceEntry[];
        const last = entries[entries.length - 1] as any;
        if (last?.startTime) send("LCP", Math.round(last.startTime));
      }).observe({ type: "largest-contentful-paint", buffered: true });

      // CLS — sum of session-window shifts
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const e = entry as any;
          if (!e.hadRecentInput) cls += e.value;
        }
      }).observe({ type: "layout-shift", buffered: true });

      // INP — coarse approximation via event timings
      let worstInp = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const dur = (entry as any).duration as number;
          if (dur > worstInp) {
            worstInp = dur;
            send("INP", Math.round(worstInp));
          }
        }
      }).observe({ type: "event", buffered: true, durationThreshold: 16 } as any);

      // TTFB
      const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      if (nav) send("TTFB", Math.round(nav.responseStart));
    } catch {
      // older browsers — don't crash
    }

    const onHide = () => reportCls();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") onHide();
    });
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
    };
  }, [consent.statistik, clinicSlug, treatmentSlug]);

  return null;
}
