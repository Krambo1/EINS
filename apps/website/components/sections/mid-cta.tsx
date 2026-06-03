import { ArrowUpRight } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { Reveal } from "@/components/ui/reveal";
import { CALENDLY_URL } from "@/lib/constants";

// Mid-page conversion prompt, placed after the Guarantee where conviction peaks.
export function MidCta() {
  return (
    <section className="relative py-16 md:py-24">
      <div className="container">
        <Reveal>
          <div className="card-glow mx-auto flex max-w-3xl flex-col items-center gap-5 rounded-2xl border border-border bg-bg-secondary/60 px-6 py-10 text-center backdrop-blur-sm md:px-10 md:py-12">
            <p className="display-m">Bereit für planbar mehr Selbstzahler?</p>
            <p className="max-w-xl text-lg text-fg-primary md:text-xl">
              In 30 Minuten klären wir, ob das EINS-System zu Ihrer Praxis passt.
              Unverbindlich, konkret und ohne Verkaufsdruck.
            </p>
            <ShinyButton href={CALENDLY_URL}>
              Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
            </ShinyButton>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
