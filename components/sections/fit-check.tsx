import { Check, X } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { FOR_YOU, NOT_FOR_YOU } from "@/lib/fit-data";
import { md } from "@/lib/md";

export function FitCheck() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="block">Für wen das System passt.</span>
            <span className="block font-normal">Und für wen nicht.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 mx-auto max-w-2xl text-center text-lg text-fg-primary md:text-xl">
            Ehrlich gesagt: Wir arbeiten nicht mit jedem. Hier sehen Sie sofort, ob es für Ihre Praxis passt.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-6 md:mt-16 md:grid-cols-2">
          <Reveal delay={0.1}>
            <div className="card-glow relative h-full overflow-hidden rounded-3xl border border-red-400/30 bg-gradient-to-br from-red-400/[0.05] to-white/[0.015] p-5 backdrop-blur-sm md:p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
                style={{ background: "radial-gradient(circle, rgba(248,113,113,0.12), transparent 60%)" }}
              />
              <div className="font-mono text-lg text-red-400">
                Nicht für Sie, wenn
              </div>
              <ul className="mt-8 space-y-5">
                {NOT_FOR_YOU.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg leading-snug text-fg-primary md:text-xl">
                    <X className="mt-1 h-5 w-5 shrink-0 text-red-400" />
                    <span>{md(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="card-glow relative h-full overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/[0.06] to-white/[0.015] p-5 backdrop-blur-sm md:p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
                style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              />
              <div className="font-mono text-lg text-accent">
                Perfekt für Sie, wenn
              </div>
              <ul className="mt-8 space-y-5">
                {FOR_YOU.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-lg leading-snug text-fg-primary md:text-xl">
                    <Check className="mt-1 h-5 w-5 shrink-0 text-accent" />
                    <span>{md(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
