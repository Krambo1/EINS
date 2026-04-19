import { Camera, TrendingUp, Bot } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { LAYERS } from "@/lib/system-data";

const ICONS = [Camera, TrendingUp, Bot];

export function System() {
  return (
    <section id="system" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Drei Ebenen. Ein System.
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {LAYERS.map((layer, i) => {
            const Icon = ICONS[i];
            return (
            <Reveal key={layer.number} delay={0.1 + i * 0.1}>
              <article className="card-glow group relative h-full rounded-2xl border border-border bg-bg-primary p-5 md:p-8 transition-all duration-300 ease-expo hover:border-accent/50">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="flex items-start">
                  <Icon className="h-8 w-8 text-accent" strokeWidth={1.5} />
                </div>
                <h3 className="mt-10 font-display text-2xl font-semibold tracking-tight">{layer.title}</h3>
                <ul className="mt-6 space-y-3 text-base leading-relaxed text-fg-secondary">
                  {layer.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </article>
            </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
