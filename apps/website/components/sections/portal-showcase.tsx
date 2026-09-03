import { Lock } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { PortalVideoShowcase } from "@/components/ui/portal-video-showcase";

// EINS Portal showcase. Sits directly under the hero so the product itself is
// the first thing a clinic sees, before the problem/solution argument. The
// whole block is framed in one card (grey surface so the white screenshot
// mockup pops) with a soft mint wash + lit top edge. Opacity modifiers on the
// var-tokens (bg-accent/NN) don't render on this site, so the mint accents use
// literal rgba inline styles.
export function PortalShowcase() {
  return (
    <section id="portal" className="section relative">
      <div className="container">
        <Reveal delay={0.1}>
          <div className="shiny-card card-glow relative mx-auto max-w-5xl overflow-hidden rounded-[2rem] bg-transparent">
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
                  <span className="whitespace-nowrap">Sie sehen jeden Tag,</span>
                  <br />
                  <span className="text-accent">was Ihre Werbung bringt.</span>
                </h4>
              </div>

              {/* Negative margins pull the video out of the card padding so it
                  nearly fills the card width on mobile, but stop a few px short
                  of the edge so the card's animated border stays clear of the
                  video even at the tightest widths; desktop keeps a larger
                  gutter. */}
              <div className="relative -mx-[17.5px] mt-10 sm:-mx-6 md:-mx-10 md:mt-14">
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
    </section>
  );
}
