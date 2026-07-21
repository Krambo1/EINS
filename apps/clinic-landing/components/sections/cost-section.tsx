import { formatFromPrice } from "@/lib/format";
import type { Clinic, Treatment } from "@/lib/types";

/**
 * Section 9 — CostSection (NEW).
 *
 * Preistransparenz spät auf der Seite (nie price-first — das ist das
 * Ketten-Signal), aber ehrlich: Einstiegspreis, Preistreiber, konkretes
 * Angebot nach der Beratung. Patientinnen, die den Rahmen kennen, sagen
 * Termine deutlich seltener ab.
 */
export function CostSection({ clinic, treatment }: { clinic: Clinic; treatment: Treatment }) {
  const from = formatFromPrice(treatment.priceRange);
  const drivers = treatment.cost?.drivers ?? [];

  return (
    <section className="bg-brand-bg-soft">
      <div className="container mx-auto max-w-3xl py-16 md:py-24">
        <p className="eyebrow">Kosten</p>
        <h2 className="mt-3">Was die Behandlung kostet</h2>
        <div className="mt-8 rounded-brand-lg border border-brand-border bg-brand-bg p-6 md:p-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-display text-4xl font-semibold text-brand-fg md:text-5xl">
              ab {from}
            </span>
            <span className="text-sm text-brand-fg-muted">Einstiegspreis, je nach Befund*</span>
          </div>
          {drivers.length > 0 && (
            <div className="mt-6">
              <p className="text-sm font-semibold text-brand-fg">Der genaue Preis hängt ab von:</p>
              <ul className="mt-2 grid gap-1.5 text-sm text-brand-fg-muted sm:grid-cols-2">
                {drivers.map((d) => (
                  <li key={d} className="flex gap-2">
                    <span aria-hidden className="mt-2 h-1 w-1 flex-none rounded-full bg-brand-accent" />
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-6 text-sm leading-relaxed text-brand-fg-muted">
            Nach der Beratung erhalten Sie ein schriftliches Angebot mit dem konkreten Preis
            für Ihre Behandlung. Keine versteckten Positionen, keine Überraschung an der
            Rezeption.
          </p>
          {treatment.cost?.financingNote && (
            <p className="mt-3 text-sm text-brand-fg-muted">{treatment.cost.financingNote}</p>
          )}
        </div>
        <p className="mt-3 text-xs text-brand-fg-muted">
          *Unverbindliche Preisangabe. Der individuelle Preis richtet sich nach Befund und
          Aufwand und wird vor der Behandlung schriftlich vereinbart. Ärztliche Leistungen
          werden nach GOÄ abgerechnet.
        </p>
      </div>
    </section>
  );
}
