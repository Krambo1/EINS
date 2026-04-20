import { Mail } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/reveal";
import { OBJECTIONS } from "@/lib/objections-data";
import { CONTACT_EMAIL } from "@/lib/constants";
import { md } from "@/lib/md";

export function Objections() {
  return (
    <section id="faq" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Ihre Fragen beantwortet.
          </h2>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mx-auto mt-8 max-w-3xl md:mt-12">
            <Accordion type="single" collapsible>
              {OBJECTIONS.map((o, i) => (
                <AccordionItem key={o.q} value={`obj-${i}`}>
                  <AccordionTrigger>
                    <span className="font-display text-lg tracking-tight md:text-xl">{o.q}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="max-w-2xl leading-relaxed">{md(o.a)}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>

            <div className="mt-8 flex justify-center">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Frage%20zu%20EINS%20Visuals`}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-secondary/60 px-4 py-2 font-mono text-sm text-fg-secondary transition-colors hover:border-accent/60 hover:text-accent"
              >
                <Mail className="h-3.5 w-3.5" />
                Noch eine Frage?
                <span className="text-accent">{CONTACT_EMAIL}</span>
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
