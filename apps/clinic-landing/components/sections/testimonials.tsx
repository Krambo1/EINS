import type { Clinic } from "@/lib/types";

/** Section 8 — Patientinnenstimmen. Skipped if none provided. */
export function Testimonials({ clinic }: { clinic: Clinic }) {
  const list = clinic.testimonials ?? [];
  if (list.length === 0) return null;

  return (
    <section className="bg-brand-bg-soft">
      <div className="container mx-auto py-14 md:py-20">
        <p className="eyebrow">Stimmen aus der Praxis</p>
        <h2 className="mt-3">Was Patientinnen über die Beratung sagen</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {list.slice(0, 6).map((t, i) => (
            <figure
              key={i}
              className="card flex h-full flex-col justify-between"
            >
              <blockquote className="text-base leading-relaxed text-brand-fg">
                <span aria-hidden className="select-none text-2xl text-brand-primary">
                  „
                </span>
                {t.quote}
                <span aria-hidden className="select-none text-2xl text-brand-primary">
                  "
                </span>
              </blockquote>
              <figcaption className="mt-4 text-sm text-brand-fg-muted">
                {t.name}
                {t.age ? `, ${t.age}` : null}
                {t.city ? ` · ${t.city}` : null}
              </figcaption>
            </figure>
          ))}
        </div>
        <p className="mt-6 text-xs text-brand-fg-muted">
          Hinweis: Patientinnenstimmen wurden hand-kuratiert und mit schriftlicher Einwilligung
          veröffentlicht. Es handelt sich um individuelle Erfahrungsberichte; ein vergleichbarer
          Verlauf kann daraus nicht abgeleitet werden.
        </p>
      </div>
    </section>
  );
}
