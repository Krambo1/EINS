import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/reveal";
import { OBJECTIONS } from "@/lib/objections-data";

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
          <div className="mx-auto mt-12 max-w-3xl">
            <Accordion type="single" collapsible>
              {OBJECTIONS.map((o, i) => (
                <AccordionItem key={o.q} value={`obj-${i}`}>
                  <AccordionTrigger>
                    <span className="font-display text-lg tracking-tight md:text-xl">{o.q}</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <p className="max-w-2xl leading-relaxed">{o.a}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
