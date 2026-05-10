import type { Clinic } from "@/lib/types";

/**
 * Section 3 — Vertrauensanker.
 *
 * Renders only the data points the clinic actually has. Empty trust = empty
 * strip (the section is skipped by the page).
 */
export function TrustStrip({ clinic }: { clinic: Clinic }) {
  const items: { kpi: string; label: string }[] = [];
  if (clinic.trust.google) {
    items.push({
      kpi: `${clinic.trust.google.score.toFixed(1)} ★`,
      label: `${clinic.trust.google.count} Google-Bewertungen`,
    });
  }
  if (clinic.trust.practiceSince) {
    items.push({
      kpi: String(new Date().getFullYear() - clinic.trust.practiceSince),
      label: `Jahre eigene Praxis (seit ${clinic.trust.practiceSince})`,
    });
  }
  if (clinic.trust.treatmentVolume) {
    items.push({
      kpi: `${clinic.trust.treatmentVolume.count.toLocaleString("de-DE")}+`,
      label: `dokumentierte Behandlungen (Stand ${clinic.trust.treatmentVolume.asOfYear})`,
    });
  }
  if (clinic.doctor.memberships && clinic.doctor.memberships.length > 0) {
    items.push({
      kpi: clinic.doctor.memberships[0].split(" ").pop() ?? "Mitglied",
      label: clinic.doctor.memberships.slice(0, 2).join(" · "),
    });
  }

  if (items.length === 0) return null;

  return (
    <section
      aria-label="Vertrauensanker"
      className="border-y border-brand-border bg-brand-bg-soft"
    >
      <div className="container mx-auto py-6 md:py-8">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {items.slice(0, 4).map((it, i) => (
            <div key={i} className="text-center sm:text-left">
              <div className="text-xl font-semibold text-brand-fg md:text-2xl">{it.kpi}</div>
              <div className="mt-0.5 text-xs leading-snug text-brand-fg-muted md:text-sm">
                {it.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
