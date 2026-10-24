/**
 * Neutral page address before any pixel loads.
 *
 * Inline script, first in the body: captures utm_* and click ids into an
 * in-memory global for the pre-qualifier's `extractUtm()`, then removes every
 * utm_* from the address except utm_source, utm_medium and a utm_content that
 * is a post code (decision D6). The script and its rules live in
 * lib/attribution.ts (ATTRIBUTION_SCRIPT), tested there in a simulated
 * browser.
 *
 * No CSP is configured for clinic-landing (next.config.mjs / vercel.json), so
 * a plain inline script is allowed, same as the gtag bootstrap.
 */

import { ATTRIBUTION_SCRIPT } from "@/lib/attribution";

declare global {
  interface Window {
    __einsAttribution__?: Record<string, string>;
  }
}

export function AttributionScript() {
  return (
    <script
      id="eins-attribution"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: ATTRIBUTION_SCRIPT }}
    />
  );
}
