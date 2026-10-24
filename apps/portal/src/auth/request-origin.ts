/**
 * Cross-site request detection for state-changing auth endpoints that are
 * reachable by plain links or forms (logout, end impersonation, the magic-link
 * POST). Pure: takes a Headers object, no Next imports.
 *
 * Browsers send `Sec-Fetch-Site` on every request (all evergreen browsers
 * since 2020-2023). A top-level click from our own page is "same-origin", a
 * typed URL / bookmark is "none", an <img> or form on a foreign site is
 * "cross-site" (B-15). Without that header we fall back to comparing the
 * Origin header's host with the Host header; a request with neither header
 * (curl, very old browser) is treated as not cross-site, because the session
 * cookie is SameSite=Lax anyway and blocks the cross-site POST variant.
 */
export function isCrossSiteRequest(headers: Headers): boolean {
  const site = headers.get("sec-fetch-site");
  if (site) {
    return site !== "same-origin" && site !== "none";
  }
  const origin = headers.get("origin");
  if (!origin || origin === "null") return origin === "null";
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host.toLowerCase() !== host.toLowerCase();
  } catch {
    return true;
  }
}
