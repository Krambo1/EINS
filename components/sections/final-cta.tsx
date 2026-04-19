import { ArrowUpRight } from "lucide-react";
import { ShinyButton } from "@/components/ui/shiny-button";
import { Reveal } from "@/components/ui/reveal";
import { CALENDLY_URL, CONTACT_EMAIL } from "@/lib/constants";

export function FinalCta() {
  return (
    <section className="relative overflow-hidden py-32 md:py-48">
      <div className="container relative">
        <Reveal>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Nichts zu ändern ist
            <br />
            auch eine Entscheidung.
            <br />
            <span className="text-accent-gradient">Meist die teuerste.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.25}>
          <div id="final-cta" className="mt-12 flex flex-col items-center gap-6">
            <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
              Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
            </ShinyButton>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-center font-mono text-base text-fg-secondary transition-colors hover:text-fg-primary"
            >
              Oder schreiben Sie uns: {CONTACT_EMAIL}
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
