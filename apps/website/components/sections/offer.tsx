import { Reveal } from "@/components/ui/reveal";
import { BUDGET_NOTE } from "@/lib/system-data";

export function Offer() {
  return (
    <section id="angebot" className="section relative !pt-0 -mt-16 md:-mt-24">
      <div className="container">
        {/* Single retainer tier: bundles every card above into one monthly
            package. The feature list lives in the cards; this section frames
            them as one bundled offer and adds the budget note (copy in
            lib/system-data.ts, BUDGET_NOTE). The portal showcase moved up under
            the hero (see components/sections/portal-showcase.tsx). */}
        <Reveal delay={0.15}>
          <div>
            <Reveal delay={0.18}>
              <div className="mx-auto max-w-5xl rounded-2xl border border-accent/40 bg-accent/[0.06] p-6 backdrop-blur-sm md:p-8">
                <div className="font-mono text-base font-medium text-accent">
                  {BUDGET_NOTE.label}
                </div>
                <h4 className="mt-2 font-display text-2xl font-semibold tracking-tight md:text-4xl">
                  {BUDGET_NOTE.title}
                </h4>
                <p className="mt-3 text-lg leading-relaxed text-fg-primary md:text-xl">
                  {BUDGET_NOTE.body}
                </p>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
