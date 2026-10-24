"use client";

import * as React from "react";
import Script from "next/script";
import { useConsent } from "@/components/consent/consent-context";
import { drainTrackQueue } from "./track";

interface Props {
  adsId: string;
}

/**
 * Google Ads gtag.js — only mounts after marketing consent.
 * Uses next/script with `afterInteractive` so it never delays LCP.
 *
 * L-7: like the Meta pixel, Google must not learn the treatment from the
 * page. The path (`/<praxis>/<behandlung>`), title and referrer are replaced
 * by the bare origin and a neutral title for every hit, the automatic
 * page_view is off, and enhanced conversions are OFF: gtag could read
 * e-mail/phone from the form ("automatic detection" in the Ads account), and
 * the per-form ad-reporting consent only exists after submit, so the browser
 * tag cannot be gated on it. Server-side reporting (/api/lead) stays the only
 * consent-gated path.
 */
export function GoogleAds({ adsId }: Props) {
  const consent = useConsent();

  React.useEffect(() => {
    if (consent.marketing) drainTrackQueue();
  }, [consent.marketing]);

  if (!consent.marketing) return null;

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${adsId}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          var neutral = window.location.origin + '/';
          gtag('config', '${adsId}', {
            'send_page_view': false,
            'allow_enhanced_conversions': false,
            'page_location': neutral,
            'page_referrer': neutral,
            'page_title': 'Zielseite'
          });
        `}
      </Script>
    </>
  );
}
