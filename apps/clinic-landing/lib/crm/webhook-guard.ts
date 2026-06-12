/**
 * SSRF guard for clinic-landing outbound webhook fetches.
 *
 * The per-clinic webhook URL is operator-config (env `LEAD_WEBHOOK_URL_<SLUG>`
 * or committed `clinic.connectors.webhookUrl`). A misconfigured or hostile
 * value pointed at an internal address (e.g. `http://169.254.169.254/` cloud
 * metadata, `http://10.x` internal services) turns every lead/DOI POST into an
 * SSRF probe that also leaks patient PHI (pentest M14 / APVS-07).
 *
 * Policy: in production, only https to a non-private host is allowed. In dev we
 * allow anything so local webhook testing (localhost, n8n on a LAN) still works
 * — there is no sensitive internal infra to probe on a dev box.
 */

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1") return true;
  // IPv4 loopback / private / link-local (incl. 169.254.169.254 metadata).
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  if (/^0\./.test(h)) return true;
  // IPv6 unique-local / link-local.
  if (/^f[cd][0-9a-f]{2}:/i.test(h)) return true;
  if (/^fe80:/i.test(h)) return true;
  return false;
}

export function isAllowedWebhookUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== "production") return true;
  if (u.protocol !== "https:") return false;
  return !isPrivateHost(u.hostname);
}
