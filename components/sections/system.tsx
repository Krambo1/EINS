import { Camera, TrendingUp, Bot } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { LAYERS } from "@/lib/system-data";
import { md } from "@/lib/md";

const ICONS = [Camera, TrendingUp, Bot];

export function System() {
  return (
    <section id="system" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="text-accent-gradient">Marketing</span> für Ihre Klinik.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-5 text-balance text-center font-display text-3xl font-semibold tracking-tight text-fg-primary md:text-4xl">
            Werden Sie zur EINS in Ihrer Region.
          </p>
        </Reveal>

        <div className="mt-10 grid gap-6 md:mt-16 md:grid-cols-3">
          {LAYERS.map((layer, i) => {
            const Icon = ICONS[i];
            return (
            <Reveal key={layer.number} delay={0.1 + i * 0.1}>
              <article className="card-glow group relative h-full rounded-2xl border border-border bg-bg-primary p-6 md:p-10 transition-all duration-300 ease-expo hover:border-accent/50">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="flex items-start">
                  <Icon className="h-11 w-11 text-accent" strokeWidth={1.75} />
                </div>
                <h3 className="mt-8 font-display text-3xl font-semibold tracking-tight md:text-4xl">{layer.title}</h3>
                <ul className="mt-6 space-y-4 text-lg leading-relaxed text-fg-primary md:text-xl">
                  {layer.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className="mt-[0.6em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{md(b)}</span>
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
