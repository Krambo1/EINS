import { Counter } from "@/components/ui/counter";
import { Reveal } from "@/components/ui/reveal";
import { STATS } from "@/lib/stats-data";

const statValue = (id: string) => {
  const s = STATS.find((s) => s.id === id);
  if (!s) throw new Error(`Stat not found: ${id}`);
  return s.bigNumber.value;
};

const MARKET_STATS = [
  { value: 90, label: "der Praxen wirken online wie Behandler, nicht wie Premium-Marken" },
  { value: statValue("germans-research"), label: "der deutschen Patienten recherchieren online, bevor sie buchen" },
  { value: statValue("compare-providers"), label: "vergleichen 2 bis 5 Anbieter vor der Entscheidung" },
];

export function MarketReality() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="block">Der Markt ist nicht überfüllt.</span>
            <span className="block">Er ist visuell schwach.</span>
          </h2>
        </Reveal>

        <div className="mt-16 grid gap-10 border-t border-border pt-12 md:grid-cols-3 md:gap-16">
          {MARKET_STATS.map((s, i) => (
            <Reveal key={s.value} delay={0.1 + i * 0.1}>
              <div className="flex flex-col items-center text-center">
                <div className="font-display text-6xl font-semibold tracking-tightest text-fg-primary md:text-7xl">
                  <Counter to={s.value} suffix="%" />
                </div>
                <div className="mt-4 max-w-xs text-base leading-relaxed text-fg-secondary">{s.label}</div>
              </div>
            </Reveal>
          ))}
        </div>

      </div>
    </section>
  );
}
