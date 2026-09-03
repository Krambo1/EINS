import { Reveal } from "@/components/ui/reveal";

export function Offer() {
  return (
    <section id="angebot" className="section relative !pt-0 -mt-16 md:-mt-24">
      <div className="container">
        {/* Single retainer tier — bundles every Marketing card above into one
            monthly package. The feature list lives in the cards now; this
            section frames them as one bundled offer and adds the budget
            transparency note. The portal showcase moved up under the hero
            (see components/sections/portal-showcase.tsx). */}
        <Reveal delay={0.15}>
          <div>
            {/* Ad budget notice. Werbebudget-Kontrolle is now listed as a feature
                of the Social-Ads card above; this block keeps the cost picture
                honest. */}
            <Reveal delay={0.18}>
              <div className="mx-auto max-w-5xl rounded-2xl border border-accent/40 bg-accent/[0.06] p-6 backdrop-blur-sm md:p-8">
                <div className="font-mono text-base font-medium text-accent">
                  Wichtig zu wissen
                </div>
                <h4 className="mt-2 font-display text-2xl font-semibold tracking-tight md:text-4xl">
                  Werbebudget ist extra.
                </h4>
                <p className="mt-3 text-lg leading-relaxed text-fg-primary md:text-xl">
                  Sie zahlen Ihr Werbebudget direkt an Meta und Google, nicht an uns. Volle Transparenz über jeden Euro.
                </p>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
