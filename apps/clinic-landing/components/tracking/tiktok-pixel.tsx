"use client";

import * as React from "react";
import { useConsent } from "@/components/consent/consent-context";
import { drainTrackQueue } from "./track";

interface Props {
  pixelId: string;
}

export function TikTokPixel({ pixelId }: Props) {
  const consent = useConsent();
  const initialized = React.useRef(false);

  React.useEffect(() => {
    if (!consent.marketing || initialized.current) return;
    initialized.current = true;

    // TikTok Pixel snippet (verbatim, minus auto-tracking we don't want).
    /* eslint-disable */
    (function (w: any, d: any, t: any) {
      w.TiktokAnalyticsObject = t;
      const ttq = (w[t] = w[t] || []);
      ttq.methods = [
        "page",
        "track",
        "identify",
        "instances",
        "debug",
        "on",
        "off",
        "once",
        "ready",
        "alias",
        "group",
        "enableCookie",
        "disableCookie",
      ];
      ttq.setAndDefer = function (t: any, e: any) {
        t[e] = function () {
          t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
        };
      };
      for (let i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);
      ttq.instance = function (t: any) {
        const e = ttq._i[t] || [];
        for (let n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]);
        return e;
      };
      ttq.load = function (e: any, n?: any) {
        const i = "https://analytics.tiktok.com/i18n/pixel/events.js";
        ttq._i = ttq._i || {};
        ttq._i[e] = [];
        ttq._i[e]._u = i;
        ttq._t = ttq._t || {};
        ttq._t[e] = +new Date();
        ttq._o = ttq._o || {};
        ttq._o[e] = n || {};
        const o = document.createElement("script");
        o.type = "text/javascript";
        o.async = !0;
        o.src = i + "?sdkid=" + e + "&lib=" + t;
        const a = document.getElementsByTagName("script")[0];
        a.parentNode!.insertBefore(o, a);
      };
      ttq.load(pixelId);
      ttq.page();
    })(window, document, "ttq");
    /* eslint-enable */

    drainTrackQueue();
  }, [consent.marketing, pixelId]);

  return null;
}
