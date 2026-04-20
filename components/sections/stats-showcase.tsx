import { Reveal } from "@/components/ui/reveal";
import { TabExplorer } from "@/components/ui/tab-explorer";

export function StatsShowcase() {
  return (
    <section id="ergebnisse" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Echte Statistiken aus echten Kliniken.
          </h2>
        </Reveal>
        <div className="mt-8 md:mt-12">
          <TabExplorer />
        </div>
      </div>
    </section>
  );
}
