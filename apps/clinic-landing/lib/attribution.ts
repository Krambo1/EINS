/**
 * Visit attribution: the inline address-cleaning script and the pure helpers
 * that read what it captured. Kept free of React so lib/attribution.test.ts
 * can run the exact script string in a simulated browser.
 *
 * Privacy rule (06.10.2026): ad links carry `utm_campaign=<behandlung>` (and
 * Google `utm_term` with search words); pixels send the full page address.
 * The script runs at HTML parse time, before hydration and before any
 * consent-gated pixel effect: it copies utm_* and the click ids into an
 * in-memory global (no storage), then removes every utm_* from the address
 * EXCEPT
 *   - utm_source and utm_medium: they only say which platform and whether
 *     paid, and they must survive a reload / tab restore, otherwise
 *     `paidAdPlatformOfVisit` cannot tell a paid Meta visit (fbclid alone does
 *     not count);
 *   - utm_content, but ONLY when it is a post code (decision D6, see
 *     lib/post-code.ts). A post code is random letters and digits and says
 *     nothing about the person or a treatment; keeping it means a reload no
 *     longer loses the post. Any other utm_content (ad names, free text) is
 *     stripped as before.
 * Click ids stay in the URL so the pixels / gtag can still set their click
 * cookies. After a reload the stripped utm_campaign / utm_term (and a
 * non-code utm_content) are gone.
 *
 * The regex literal below is POST_CODE_PATTERN_SOURCE written out (the script
 * is a plain string, it cannot import); lib/attribution.test.ts pins it.
 */

export const CLICK_ID_PARAMS = ["fbclid", "gclid", "wbraid", "gbraid", "ttclid"] as const;

export const ATTRIBUTION_SCRIPT = `(function(){try{
var u=new URL(window.location.href),p=u.searchParams,o={},d=[],k=["fbclid","gclid","wbraid","gbraid","ttclid"],c=/^(?=[bcdfghjkmnpqrstvwxz2-9]*[2-9])(?=[bcdfghjkmnpqrstvwxz2-9]*[bcdfghjkmnpqrstvwxz])[bcdfghjkmnpqrstvwxz2-9]{5}$/;
p.forEach(function(v,n){var utm=n.indexOf("utm_")===0;if(utm||k.indexOf(n)>-1)o[n]=v;if(utm&&n!=="utm_source"&&n!=="utm_medium"&&!(n==="utm_content"&&c.test(v))&&d.indexOf(n)<0)d.push(n);});
window.__einsAttribution__=o;
if(d.length){d.forEach(function(n){p.delete(n);});var q=p.toString();
window.history.replaceState(window.history.state,"",u.pathname+(q?"?"+q:"")+u.hash);}
}catch(e){}})();`;

function isAttributionParam(name: string): boolean {
  return name.startsWith("utm_") || (CLICK_ID_PARAMS as readonly string[]).includes(name);
}

/**
 * The visit's utm_* and click ids: the script's in-memory copy when present
 * (it saw the full ad link), otherwise whatever is still in the address.
 * Used by the pre-qualifier for the intake payload.
 */
export function extractUtmFrom(
  captured: Record<string, string> | undefined,
  search: string,
): Record<string, string> | undefined {
  if (captured && Object.keys(captured).length > 0) return { ...captured };
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(search).entries()) {
    if (isAttributionParam(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Practice start page: the link to a treatment page carrying every utm_* and
 * click id of this visit, so the treatment page's script captures them again
 * (and strips what must not stay in the address there).
 */
export function withAttribution(path: string, attribution: Record<string, string> | undefined): string {
  if (!attribution) return path;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(attribution)) {
    if (isAttributionParam(k)) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
