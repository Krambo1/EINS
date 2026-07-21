import type { Treatment } from "@/lib/types";

/**
 * Section 8 — So läuft es bei Ihnen ab. Vertical timeline: each step is a
 * numbered node on a connecting line. Die Bedenkzeit als eigener Schritt ist
 * ein Seriositätssignal, kein Hindernis.
 */
export function ProcessSteps({ treatment }: { treatment: Treatment }) {
  const steps = treatment.process.steps;
  return (
    <section className="bg-brand-bg">
      <div className="container mx-auto max-w-3xl py-16 md:py-24">
        <p className="eyebrow">05 · Ihr Weg</p>
        <h2 className="mt-3">So läuft es bei Ihnen ab</h2>
        <ol className="mt-10">
          {steps.map((s, i) => (
            <li key={s.index} className="relative flex gap-5 pb-10 last:pb-0">
              {i < steps.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px bg-brand-border"
                />
              )}
              <div className="z-10 flex h-10 w-10 flex-none items-center justify-center rounded-full border border-brand-border bg-brand-primary-soft font-display font-semibold text-brand-primary">
                {s.index}
              </div>
              <div className="pt-1.5">
                <h3 className="text-base font-semibold text-brand-fg sm:text-lg">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-brand-fg-muted">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
