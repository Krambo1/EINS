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
          <div id="final-cta" className="mt-12 flex flex-col items-center gap-1">
            <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
              Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
            </ShinyButton>
            <span className="inline-flex items-center gap-2 font-mono text-sm text-fg-primary">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
              Verfügbar · 30 Minuten
            </span>
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="mt-5 text-center font-mono text-base text-fg-secondary transition-colors hover:text-fg-primary"
            >
              Oder schreiben Sie uns: {CONTACT_EMAIL}
            </a>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
