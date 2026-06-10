import { Lock } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { PortalVideoShowcase } from "@/components/ui/portal-video-showcase";

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
                portal reads as a pillar of the offer, not a separate upsell. The
                whole block is now framed in one card (grey surface so the white
                screenshot mockup pops) with a soft mint wash + lit top edge.
                Opacity modifiers on the var-tokens (bg-accent/NN) don't render on
                this site, so the mint accents use literal rgba inline styles. Tabs
                swap between live screenshots so clinics see what they get rather
                than reading another bullet list. */}
            <Reveal delay={0.1}>
              <div className="shiny-card card-glow relative mx-auto mt-28 max-w-5xl overflow-hidden rounded-[2rem] bg-transparent md:mt-44">
                {/* Lit mint top edge, echoing the portal showcase's glow. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent, #58BAB5, transparent)",
                  }}
                />
                {/* Soft mint wash bleeding down from the top. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 top-0 h-48"
                  style={{
                    background:
                      "linear-gradient(to bottom, rgba(88,186,181,0.10), transparent)",
                  }}
                />

                <div className="relative px-5 py-12 sm:px-8 md:px-14 md:py-16">
                  <div className="relative mx-auto max-w-3xl text-center">
                    <p className="font-mono text-lg font-medium text-fg-primary md:text-2xl">
                      Ihre EINS Praxis-Software
                    </p>
                    <h4 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-6xl">
                      Sie sehen jeden Tag, <span className="text-accent">was Ihre Werbung bringt.</span>
                    </h4>
                  </div>

                  {/* Negative margins cancel the card padding so the video gets
                      the full card width on mobile and keeps only a small
                      gutter on desktop. */}
                  <div className="relative -mx-5 mt-10 sm:-mx-8 md:-mx-10 md:mt-14">
                    <PortalVideoShowcase />
                  </div>

                  <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:mt-10">
                    <span className="eyebrow">Enthalten</span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-secondary">
                      <Lock className="h-3 w-3" aria-hidden />
                      Privater Praxis-Zugang
                    </span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
