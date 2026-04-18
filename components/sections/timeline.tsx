import { Reveal } from "@/components/ui/reveal";
import { STATIONS } from "@/lib/timeline-data";

export function Timeline() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Von Tag 1 bis zur ersten Implantat-Anfrage.
          </h2>
        </Reveal>

        <div className="relative mt-16">
          {/* Connector line */}
          <div
            aria-hidden
            className="absolute left-0 right-0 top-6 hidden h-px bg-gradient-to-r from-border via-accent/60 to-border md:block"
          />
          <div className="grid gap-10 md:grid-cols-4 md:gap-6">
            {STATIONS.map((s, i) => (
              <Reveal key={s.title} delay={0.1 + i * 0.1}>
                <div className="relative">
                  <div className="flex items-center gap-3 md:block">
                    <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border border-accent/40 bg-bg-primary text-accent">
                      <span className="h-2 w-2 rounded-full bg-accent" />
                    </span>
                    <span className="font-mono text-base text-fg-secondary md:mt-4 md:block">
                      {s.when}
                    </span>
                  </div>
                  <h3 className="mt-4 font-display text-xl font-semibold tracking-tight">
                    {s.title}
                  </h3>
                  <ul className="mt-3 space-y-2 text-base leading-relaxed text-fg-secondary">
                    {s.bullets.map((b) => (
                      <li key={b} className="flex gap-2">
                        <span className="text-fg-secondary">-</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
