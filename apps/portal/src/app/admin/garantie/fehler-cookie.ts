/**
 * V7 5.6: a refused Garantie action hands its message to the page through this
 * short-lived cookie instead of `redirect(...?fehler=...)`.
 *
 * Why no redirect: a Server Action redirect makes Next fetch the target page
 * server side from `__NEXT_PRIVATE_ORIGIN` (http://localhost:<port> under
 * `next dev` / `next start`). Node's fetch cannot set the Host header, so the
 * middleware sees the clinic host, rewrites `/admin/*` to /404 and the browser
 * renders "Seite nicht gefunden" until a reload (Next.js #65893, same reason
 * the admin login returns state). Without a redirect the action response
 * re-renders the current page, which reads this cookie.
 */
export const GARANTIE_FEHLER_COOKIE = "eins_garantie_fehler";

/** Seconds; long enough for the action response, short enough not to linger. */
export const GARANTIE_FEHLER_MAX_AGE = 10;

export type GarantieFehler = { clinicId: string; message: string };

export function parseGarantieFehler(raw: string | undefined, clinicId: string): string | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<GarantieFehler>;
    if (v && v.clinicId === clinicId && typeof v.message === "string" && v.message.length > 0) {
      return v.message.slice(0, 500);
    }
  } catch {
    // ignore a malformed cookie
  }
  return null;
}
