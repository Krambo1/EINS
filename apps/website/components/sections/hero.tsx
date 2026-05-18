import { ArrowUpRight, Clock } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { CALENDLY_URL } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden pb-16 pt-32 md:pt-40">
      <div className="container">
        <div className="max-w-7xl mx-auto text-center">
          <h1 className="display-xl leading-[1.05] hero-fade-in">
            <span className="block whitespace-nowrap">Mehr Patienten.</span>
            <span className="block whitespace-nowrap">Mehr Umsatz.</span>
            <ShimmerText className="block whitespace-nowrap">Mehr Sicherheit.</ShimmerText>
          </h1>

          <p
            className="mt-6 mx-auto max-w-[34ch] font-display text-2xl font-semibold leading-tight tracking-tight text-fg-primary hero-fade-in md:mt-10 md:max-w-[52ch] md:text-4xl lg:text-5xl"
            style={{ animationDelay: "100ms" }}
          >
            <span className="block">Das integrierte Wachstumssystem</span>
            <span className="block">für Ästhetik-Praxen.</span>
          </p>

          <div
            id="hero-cta"
            className="mt-6 flex flex-wrap items-start justify-center gap-4 hero-fade-in md:mt-10"
            style={{ animationDelay: "200ms" }}
          >
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
                <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
