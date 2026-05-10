/**
 * Host-header → clinic-slug map, built statically from the registry at module load.
 *
 * The middleware uses this to rewrite `praxis-mueller.de/botox-muenchen`
 * to `/praxis-mueller-muenchen/botox-muenchen` server-side, so the patient
 * sees the clinic's own domain throughout the journey.
 */

import { listClinics } from "./clinic-registry";

export function buildDomainMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const clinic of listClinics()) {
    for (const domain of clinic.domains) {
      const norm = normalizeHost(domain);
      const existing = m.get(norm);
      if (existing && existing !== clinic.slug) {
        throw new Error(
          `Domain conflict: "${norm}" is claimed by both "${existing}" and "${clinic.slug}"`,
        );
      }
      m.set(norm, clinic.slug);
      // Map both apex and www variant for convenience.
      if (norm.startsWith("www.")) {
        m.set(norm.slice(4), clinic.slug);
      } else {
        m.set(`www.${norm}`, clinic.slug);
      }
    }
  }
  return m;
}

export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/].*$/, "")
    .replace(/:\d+$/, "")
    .trim();
}

const DOMAIN_MAP = buildDomainMap();

export function clinicSlugForHost(host: string): string | null {
  return DOMAIN_MAP.get(normalizeHost(host)) ?? null;
}

/**
 * For local dev: clinic-landing.vercel.app and localhost should fall through
 * to the directly-addressable internal route (`/<slug>/<treatment>`).
 */
export function isInternalHost(host: string): boolean {
  const h = normalizeHost(host);
  return (
    h === "localhost" ||
    h.endsWith(".vercel.app") ||
    h.endsWith(".local") ||
    h === "127.0.0.1"
  );
}
