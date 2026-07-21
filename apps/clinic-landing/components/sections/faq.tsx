import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { Treatment } from "@/lib/types";

/**
 * Section 10 — FAQ. Questions are ordered by objection weight per treatment
 * (heaviest anxiety first) — the ordering lives in the treatment configs.
 */
export function FAQ({ treatment }: { treatment: Treatment }) {
  return (
    <section id="faq" className="scroll-mt-24 bg-brand-bg-soft">
      <div className="container mx-auto max-w-3xl py-16 md:py-24">
        <p className="eyebrow">06 · Häufige Fragen</p>
        <h2 className="mt-3">Was Patientinnen vor dem ersten Termin fragen</h2>
        <Accordion
          type="single"
          collapsible
          className="mt-8 rounded-brand-lg border border-brand-border bg-brand-bg px-5"
        >
          {treatment.faq.map((item, i) => (
            <AccordionItem key={i} value={`q-${i}`}>
              <AccordionTrigger>{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}
