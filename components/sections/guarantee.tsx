import { Check } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";

export function Guarantee() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Sie zahlen für Ergebnisse,
            <br />
            <span className="text-fg-secondary">nicht für Aktivität.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.12}>
          <p className="mt-6 mx-auto max-w-xl text-center text-lg text-fg-secondary">
            Wir nehmen pro Region nur eine Klinik pro Behandlungsschwerpunkt an. Nicht weil wir exklusiv klingen wollen, sondern weil wir lieber wenige Kliniken wirklich gut betreuen.
          </p>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-12 grid gap-6 md:grid-cols-[1.5fr_1fr]">
            <div className="relative overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:p-12">
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
                style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
                aria-hidden
              />
              <div className="font-mono text-base text-accent">
                90-Tage-Garantie
              </div>
              <p className="mt-4 font-display text-2xl leading-tight tracking-tight md:text-3xl">
                Wenn wir nach 90 Tagen nicht mindestens 10 ernsthafte Anfragen pro 1.000 € Werbebudget für Sie geholt haben, stehen wir dafür gerade:
              </p>
              <ul className="mt-8 space-y-4">
                <li className="flex items-start gap-3 text-fg-primary">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-accent" />
                  <span>Monat 4 geht auf uns — keine Gebühren.</span>
                </li>
                <li className="flex items-start gap-3 text-fg-primary">
                  <Check className="mt-1 h-5 w-5 shrink-0 text-accent" />
                  <span>Wir produzieren 3 neue Medien-Assets kostenfrei für Sie.</span>
                </li>
              </ul>
            </div>

            <div className="card-glow rounded-3xl border border-border bg-bg-secondary p-5 md:p-8">
              <div className="font-mono text-base text-fg-secondary">
                Definition: qualifizierte Anfrage
              </div>
              <ul className="mt-6 space-y-3 text-base leading-relaxed text-fg-secondary">
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>Ausgefülltes Formular mit konkretem Behandlungswunsch (Implantat, Invisalign, Zahnersatz).</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>Budgetindikation vorhanden.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>Bereit für Beratungsgespräch innerhalb 30 Tagen.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                  <span>KI-Bewertung stuft die Anfrage als qualifiziert ein.</span>
                </li>
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
