import { Reveal } from "@/components/ui/reveal";
import { LAYERS } from "@/lib/system-data";

function Shape({ kind }: { kind: "triangle" | "circle" | "square" }) {
  const common = "text-accent";
  if (kind === "triangle")
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" className={common}>
        <path d="M20 4 L36 34 L4 34 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  if (kind === "circle")
    return (
      <svg width="40" height="40" viewBox="0 0 40 40" className={common}>
        <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" className={common}>
      <rect x="5" y="5" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

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
          {LAYERS.map((layer, i) => (
            <Reveal key={layer.number} delay={0.1 + i * 0.1}>
              <article className="card-glow group relative h-full rounded-2xl border border-border bg-bg-primary p-8 transition-all duration-300 ease-expo hover:border-accent/50">
                <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                <div className="flex items-start justify-between">
                  <Shape kind={layer.shape} />
                  <div className="flex items-center gap-2">
                    {layer.number === "03" && (
                      <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs font-medium text-bg-primary">
                        KI
                      </span>
                    )}
                    <span className="font-mono text-base text-fg-secondary">{layer.number}</span>
                  </div>
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
          ))}
        </div>
      </div>
    </section>
  );
}
