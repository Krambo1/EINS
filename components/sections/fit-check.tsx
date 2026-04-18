import { Check, X } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { FOR_YOU, NOT_FOR_YOU } from "@/lib/fit-data";

export function FitCheck() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Für wen das System passt.
            <br />
            <span className="text-fg-secondary">Und für wen nicht.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-2">
          <Reveal delay={0.1}>
            <div className="card-glow h-full rounded-3xl border border-border bg-bg-secondary p-8">
              <div className="font-mono text-base text-red-400/70">
                Nicht für Sie, wenn
              </div>
              <ul className="mt-8 space-y-4">
                {NOT_FOR_YOU.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-fg-secondary">
                    <X className="mt-0.5 h-4 w-4 shrink-0 text-red-400/60" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <div className="card-glow relative h-full overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/[0.06] to-bg-secondary p-8">
              <div
                aria-hidden
                className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full"
                style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              />
              <div className="font-mono text-base text-accent">
                Perfekt für Sie, wenn
              </div>
              <ul className="mt-8 space-y-4">
                {FOR_YOU.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-fg-primary">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    <span>{item}</span>
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
