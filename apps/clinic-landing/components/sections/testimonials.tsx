import type { Clinic } from "@/lib/types";

const SOURCE_LABELS: Record<string, string> = {
  google: "Google",
  jameda: "Jameda",
  praxis: "Praxis",
};

/**
 * Section 7 — Patientenstimmen. Skipped if none provided.
 *
 * Quotes are about Betreuung, Aufklärung, Ehrlichkeit — never outcomes
 * (§ 11 Nr. 11 HWG). Source + date line makes them verifiable instead of
 * decorative.
 */
export function Testimonials({ clinic }: { clinic: Clinic }) {
  const list = clinic.testimonials ?? [];
  if (list.length === 0) return null;

  return (
    <section className="bg-brand-bg-soft">
      <div className="container mx-auto py-16 md:py-24">
        <p className="eyebrow">04 · Stimmen aus der Praxis</p>
        <h2 className="mt-3">Wie Patientinnen die Betreuung erleben</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.slice(0, 6).map((t, i) => (
            <figure key={i} className="card flex h-full flex-col justify-between p-6">
              <blockquote className="text-base leading-relaxed text-brand-fg">
                <span aria-hidden className="block font-display text-3xl leading-none text-brand-accent">
                  „
                </span>
                {t.quote}
              </blockquote>
              <figcaption className="mt-4 border-t border-brand-border pt-3 text-sm text-brand-fg-muted">
                <span className="font-medium text-brand-fg">{t.name}</span>
                {t.age ? `, ${t.age}` : null}
                {t.city ? ` · ${t.city}` : null}
                {(t.source || t.consentedAt) && (
                  <span className="mt-0.5 block text-xs">
                    {t.source ? SOURCE_LABELS[t.source] : null}
                    {t.source && t.consentedAt ? ", " : null}
                    {t.consentedAt ? t.consentedAt.slice(0, 4) : null}
                  </span>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-xs text-brand-fg-muted">
          Individuelle Erfahrungsberichte, veröffentlicht mit schriftlicher Einwilligung. Ein
          vergleichbarer Verlauf lässt sich daraus nicht ableiten.
        </p>
      </div>
    </section>
  );
}
