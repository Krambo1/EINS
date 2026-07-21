import type { Clinic } from "@/lib/types";

/**
 * Section 2 — TrustBar.
 *
 * Renders only data points the Praxis actually has. The Facharzt explainer
 * line is fixed: 35,5 % of patients don't know the title is protected — one
 * sentence turns a credential into a differentiator vs "Beauty Docs".
 */
export function TrustBar({ clinic }: { clinic: Clinic }) {
  const items: { kpi: string; label: string }[] = [];
  if (clinic.trust.google && clinic.trust.google.count > 0) {
    items.push({
      kpi: `${clinic.trust.google.score.toFixed(1).replace(".", ",")} ★`,
      label: `${clinic.trust.google.count} Google-Bewertungen`,
    });
  }
  if (clinic.trust.practiceSince) {
    items.push({
      kpi: String(new Date().getFullYear() - clinic.trust.practiceSince),
      label: `Jahre eigene Praxis (seit ${clinic.trust.practiceSince})`,
    });
  }
  if (clinic.trust.treatmentVolume && clinic.trust.treatmentVolume.count > 0) {
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

  return (
    <section aria-label="Vertrauensanker" className="border-y border-brand-border bg-brand-bg-soft">
      <div className="container mx-auto py-6 md:py-8">
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {items.slice(0, 4).map((it, i) => (
              <div key={i} className="text-center sm:text-left">
                <div className="font-display text-xl font-semibold text-brand-fg md:text-2xl">
                  {it.kpi}
                </div>
                <div className="mt-0.5 text-xs leading-snug text-brand-fg-muted md:text-sm">
                  {it.label}
                </div>
              </div>
            ))}
          </div>
        )}
        <p className={`text-sm leading-relaxed text-brand-fg-muted ${items.length > 0 ? "mt-5 border-t border-brand-border pt-4" : ""}`}>
          <span className="font-medium text-brand-fg">{clinic.doctor.facharzt}:</span>{" "}
          eine geschützte Qualifikation mit mehrjähriger Weiterbildung und Facharztprüfung.
          Anders als „Beauty Doc" oder „Schönheitschirurg" darf diesen Titel nicht jeder tragen.
        </p>
      </div>
    </section>
  );
}
