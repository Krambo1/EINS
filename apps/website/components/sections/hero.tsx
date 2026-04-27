import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShinyButton } from "@/components/ui/shiny-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { CALENDLY_URL } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden pb-16 pt-32 md:pt-40">
      <div className="container">
        <div className="hero-fade-in max-w-7xl mx-auto text-center">
          <div className="mb-6 flex justify-center md:mb-8">
            <span className="inline-flex items-center gap-3 rounded-full border border-accent/40 bg-accent/10 px-6 py-3 font-mono text-base text-fg-primary backdrop-blur-sm md:gap-3.5 md:px-8 md:py-4 md:text-lg">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-accent" />
              </span>
              Q3 2026 · Noch 2 Mandate frei
            </span>
          </div>

          <h1 className="display-xl leading-[1.05]">
            <span className="block whitespace-nowrap">Mehr Patienten.</span>
            <span className="block whitespace-nowrap">Mehr Umsatz.</span>
            <ShimmerText className="block whitespace-nowrap">Mehr Sicherheit.</ShimmerText>
          </h1>

          <p className="mt-6 mx-auto max-w-[34ch] text-balance text-xl leading-snug text-fg-primary md:mt-10 md:max-w-[52ch] md:text-2xl lg:text-3xl">
            Medienproduktion, bezahlte Anzeigen und ein durch Künstliche Intelligenz gestütztes System für Kliniken.
          </p>

          <div id="hero-cta" className="mt-6 flex flex-wrap items-start justify-center gap-4 md:mt-10">
            <div className="flex flex-col items-center gap-1">
              <ShinyButton href={CALENDLY_URL}>
                Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
              </ShinyButton>
              <span className="inline-flex items-center gap-2 font-mono text-sm text-fg-primary">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
                Verfügbar · 30 Minuten
              </span>
            </div>
            <Button asChild size="lg" variant="outline" className="hidden md:inline-flex">
              <a href="#system">System ansehen</a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
