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
              <div className="relative mx-auto mt-28 max-w-5xl md:mt-44">
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
                    Anfragen, Werbebudget und Umsatz auf einen Blick. In 30 Sekunden
                    sehen Sie, wo Ihre Praxis steht: zwischen zwei Eingriffen oder von
                    unterwegs. Klarheit jeden Morgen, nicht erst in der monatlichen
                    Auswertung.
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
