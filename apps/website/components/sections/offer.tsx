import { Lock } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { PortalTabShowcase } from "@/components/ui/portal-tab-showcase";

export function Offer() {
  return (
    <section id="angebot" className="section relative !pt-0 -mt-16 md:-mt-24">
      <div className="container">
        {/* Single retainer tier — bundles every Marketing card above into one
            monthly package. The feature list lives in the cards now; this
            section frames them as one bundled offer and adds the budget
            transparency note + portal showcase. */}
        <Reveal delay={0.15}>
          <div>
            {/* Ad budget notice. Werbebudget-Kontrolle is now listed as a feature
                of the Social-Ads card above; this block keeps the cost picture
                honest before the portal showcase. */}
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

            {/* EINS Portal showcase. Sits inside the Wachstumssystem block so the
                portal reads as a pillar of the offer, not a separate upsell. Tabs
                swap between live screenshots so clinics see what they get rather
                than reading another bullet list. */}
            <Reveal delay={0.1}>
              <div className="card-glow relative mx-auto mt-28 max-w-5xl overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary/60 to-bg-secondary/40 p-3 backdrop-blur-sm md:mt-44 md:p-12">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />

                <div className="relative mx-auto max-w-3xl text-center">
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <span className="eyebrow">Enthalten</span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-secondary">
                      <Lock className="h-3 w-3" aria-hidden />
                      Privater Praxis-Zugang
                    </span>
                  </div>
                  <p className="mt-5 font-mono text-lg font-medium text-fg-primary md:text-2xl">
                    Ihre EINS Praxis-Software
                  </p>
                  <h4 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-6xl">
                    Anfragen in Echtzeit. <span className="text-accent">Umsatz täglich.</span>
                  </h4>
                  <p className="mt-5 text-lg leading-relaxed text-fg-primary md:text-xl">
                    Portal für Ihre Praxis mit Anfragen, Werbebudget und Werbeertrag.
                    Anfragen kommen sofort an, Umsatzzahlen werden über Nacht aktualisiert.
                    Klarheit jeden Morgen, nicht erst im Monatsreport.
                  </p>
                </div>

                <div className="relative mt-10 md:mt-14">
                  <PortalTabShowcase />
                </div>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
