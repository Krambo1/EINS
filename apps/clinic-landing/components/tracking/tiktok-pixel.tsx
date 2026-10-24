"use client";

interface Props {
  pixelId: string;
}

/**
 * TikTok Pixel: switched OFF (L-7).
 *
 * The pixel sends the full page address with every call (`ttq.page()` and
 * each `ttq.track`), and the address names the treatment
 * (`/<praxis>/<behandlung>`). Unlike gtag there is no documented way to
 * override it, and the consent texts (cookie banner, lib/ads-consent.ts)
 * name only Meta and Google. So the component loads nothing, even with
 * marketing consent and a configured `tiktokPixelId`; `track()` skips TikTok
 * because `window.ttq` never exists. To bring it back: name TikTok in the
 * consent texts and send only a neutral page address (as in google-ads.tsx),
 * then restore the loader from git history.
 */
export function TikTokPixel(_props: Props) {
  return null;
}
