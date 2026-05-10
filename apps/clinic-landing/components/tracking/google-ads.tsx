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
          gtag('config', '${adsId}', { 'allow_enhanced_conversions': true });
        `}
      </Script>
    </>
  );
}
