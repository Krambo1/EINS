/**
 * J-4: which addresses a Praxis may store for EINS Bewertungen.
 *
 * Review-request mails go out from the EINS sender domain. Their links must
 * therefore only ever point at the EINS landing app or at the real review
 * pages of Google and Jameda, never at a host a hijacked portal account
 * picked. Pure functions (no env import) so they are unit-testable; callers
 * pass the configured origins.
 */

function parseHttps(value: string): URL | null {
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * True when no path segment, once percent-decoded (also double-encoded), holds
 * a `.` or `..` step or a hidden `/` or `\` that a server decoding before
 * routing could use to climb out of the allowed section (`/maps/x%2f..%2furl`).
 * Plain `%2F` inside a name stays allowed (Google encodes a "/" in place
 * names that way). The URL parser already resolves literal and `%2e` dot
 * segments, this covers what it leaves encoded.
 */
function hasNoEncodedTraversal(segments: string[]): boolean {
  for (const raw of segments) {
    let seg = raw;
    for (let i = 0; i < 3; i++) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        return false;
      }
      if (decoded === seg) break;
      seg = decoded;
    }
    if (/%[0-9a-f]{2}/i.test(seg)) return false; // still encoded after 3 rounds
    if (seg.split(/[/\\]/).some((part) => part === "." || part === "..")) return false;
  }
  return true;
}

/**
 * V3 Neben 5: the first path segment must be exactly `first` (so `/maps` and
 * `/maps/...` pass, `/mapsx` and `/maps%2f..%2furl` do not), and no segment
 * may hide an encoded traversal. `needsMore` requires at least one segment
 * after `first` (the old `/local/` prefix rule).
 */
function isUnderPathSection(pathname: string, first: string, needsMore: boolean): boolean {
  const segments = pathname.split("/");
  // pathname always starts with "/", so segments[0] is "".
  if (segments[0] !== "" || (segments[1] ?? "").toLowerCase() !== first) return false;
  if (needsMore && segments.length < 3) return false;
  return hasNoEncodedTraversal(segments.slice(2));
}

/** Google write-review targets only, not every `*.google.com` host (sites/docs/script host user pages). */
export function isAllowedGoogleReviewUrl(value: string): boolean {
  const u = parseHttps(value);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  if (host === "search.google.com") return isUnderPathSection(u.pathname, "local", true);
  if (host === "g.page") return true;
  if (host === "maps.app.goo.gl") return true;
  if (host === "www.google.com" || host === "google.com") {
    return isUnderPathSection(u.pathname, "maps", false);
  }
  return false;
}

export function isAllowedJamedaUrl(value: string): boolean {
  const u = parseHttps(value);
  if (!u) return false;
  const host = u.hostname.toLowerCase();
  return host === "jameda.de" || host.endsWith(".jameda.de");
}

/**
 * Allowed landing origins: the origin of `CLINIC_LANDING_ORIGIN` plus the
 * comma-separated `CLINIC_LANDING_ORIGINS` (custom Praxis domains served by
 * the landing app). Returns normalized origins.
 */
export function allowedLandingOrigins(
  defaultOrigin: string,
  extraOrigins: string | undefined
): Set<string> {
  const out = new Set<string>();
  for (const raw of [defaultOrigin, ...(extraOrigins ?? "").split(",")]) {
    const v = raw.trim();
    if (!v) continue;
    try {
      out.add(new URL(v).origin.toLowerCase());
    } catch {
      // ignore malformed entries
    }
  }
  return out;
}

/**
 * Normalized origin when `value` is an allowed landing origin, else null.
 * https only, except the configured default itself (http://localhost in dev).
 */
export function normalizeAllowedLandingOrigin(
  value: string,
  defaultOrigin: string,
  extraOrigins: string | undefined
): string | null {
  let u: URL;
  try {
    u = new URL(value.trim());
  } catch {
    return null;
  }
  const origin = u.origin.toLowerCase();
  if (!allowedLandingOrigins(defaultOrigin, extraOrigins).has(origin)) return null;
  let defaultNorm: string | null = null;
  try {
    defaultNorm = new URL(defaultOrigin).origin.toLowerCase();
  } catch {
    defaultNorm = null;
  }
  if (u.protocol !== "https:" && origin !== defaultNorm) return null;
  return origin;
}
