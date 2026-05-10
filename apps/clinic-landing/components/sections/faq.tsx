import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import type { Treatment } from "@/lib/types";

/** Section 10 — FAQ. */
export function FAQ({ treatment }: { treatment: Treatment }) {
  return (
    <section id="faq" className="bg-brand-bg-soft">
      <div className="container mx-auto max-w-3xl py-14 md:py-20">
        <p className="eyebrow">Häufige Fragen</p>
        <h2 className="mt-3">Was Patientinnen vor dem Beratungstermin oft fragen</h2>
        <Accordion type="single" collapsible className="mt-8 rounded-brand border border-brand-border bg-brand-bg px-5">
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
