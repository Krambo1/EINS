import { Check, ChevronDown, Minus } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/reveal";
import {
  BASISPAKET,
  BASISPAKET_PRICE,
  BASISPAKET_VALUE,
  RETAINER_ROWS,
} from "@/lib/offer-data";
import { formatEuro } from "@/lib/utils";

function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return (
      <div className="flex justify-center">
        <Check className="h-4 w-4 text-accent md:h-5 md:w-5" />
      </div>
    );
  if (v === false)
    return (
      <div className="flex justify-center">
        <Minus className="h-4 w-4 text-fg-secondary md:h-5 md:w-5" />
      </div>
    );
  return <span className="text-xs text-fg-primary md:text-lg">{v}</span>;
}

export function Offer() {
  return (
    <section id="angebot" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">Das EINS Akquisitions-System.</h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 mx-auto max-w-2xl text-center text-lg text-fg-secondary">
            Alles, was Sie brauchen, damit Patienten sich nicht mehr wegen des Preises entscheiden,
            sondern weil sie Ihnen vertrauen.
          </p>
        </Reveal>

        {/* Basispaket */}
        <Reveal delay={0.2}>
          <div className="card-glow mt-10 rounded-3xl border border-border bg-bg-secondary/60 p-5 backdrop-blur-sm md:mt-16 md:p-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <h3 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">
                  Professioneller Praxis-Auftritt
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="font-mono text-base text-fg-primary">Basispaket</span>
                  <span className="rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 font-mono text-base font-semibold text-accent">
                    Einmalzahlung
                  </span>
                </div>
              </div>
              <div className="text-left md:text-right">
                <div className="font-display text-4xl font-semibold tracking-tightest text-accent-gradient md:text-5xl">
                  {formatEuro(BASISPAKET_PRICE)}
                </div>
                <div className="font-mono text-base text-fg-secondary">
                  Kommunizierter Wert: {formatEuro(BASISPAKET_VALUE)}
                </div>
              </div>
            </div>

            <Accordion type="single" collapsible defaultValue={BASISPAKET[0].id} className="mt-8">
              {BASISPAKET.map((item) => (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger className="group [&>svg]:hidden">
                    <div className="flex min-w-0 flex-1 items-center gap-6">
                      <span className="hidden font-mono text-base text-fg-secondary md:inline">{item.number}</span>
                      <span className="font-display text-lg tracking-tight md:text-xl">
                        {item.title}
                      </span>
                    </div>
                    <div className="ml-3 flex shrink-0 flex-col items-end gap-1.5 md:ml-4 md:flex-row md:items-center md:gap-4">
                      <span className="whitespace-nowrap font-mono text-sm text-fg-secondary md:text-base">
                        Wert: {formatEuro(item.value)}
                      </span>
                      <ChevronDown className="h-4 w-4 text-fg-secondary transition-transform duration-300 ease-expo group-data-[state=open]:rotate-180" />
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-3 pl-[60px] text-base leading-relaxed">
                      {item.bullets.map((b) => (
                        <li key={b} className="flex gap-3">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </Reveal>

        {/* Retainer comparison */}
        <Reveal delay={0.15}>
          <div className="mt-12">
            <h3 className="text-center font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Standard vs. Premium
            </h3>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="font-mono text-base text-fg-primary">Patienten-Wachstumsmanagement</span>
              <span className="rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 font-mono text-base font-semibold text-accent">
                Monatlich
              </span>
            </div>

            <div className="mt-5 rounded-2xl border border-border">
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[52%] md:w-auto" />
                  <col className="w-[24%] md:w-auto" />
                  <col className="w-[24%] md:w-auto" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-bg-secondary">
                    <th className="px-3 py-3 font-mono text-sm font-normal text-fg-primary md:px-6 md:py-4 md:text-lg">
                      Komponente
                    </th>
                    <th className="px-3 py-3 text-center font-mono text-sm font-semibold text-fg-primary md:px-6 md:py-4 md:text-lg">
                      Standard
                    </th>
                    <th className="relative px-3 py-3 text-center md:px-6 md:py-4">
                      <span
                        className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2.5 py-0.5 font-mono text-[10px] font-medium text-fg-primary md:-top-3.5 md:px-3 md:text-xs"
                        aria-hidden
                      >
                        Empfohlen
                      </span>
                      <span className="font-mono text-sm font-semibold text-fg-primary md:text-lg">
                        Premium
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {RETAINER_ROWS.map((row, i) => (
                    <tr
                      key={row.label}
                      className={`border-b border-border last:border-b-0 ${
                        i === 0 ? "bg-bg-secondary/50" : ""
                      }`}
                    >
                      <td className="break-words px-3 py-3 text-base text-fg-primary md:px-6 md:py-4 md:text-lg">
                        {row.label}
                      </td>
                      <td className="break-words px-3 py-3 text-center text-base md:px-6 md:py-4 md:text-lg">
                        <Cell v={row.standard} />
                      </td>
                      <td className="break-words px-3 py-3 text-center text-base md:px-6 md:py-4 md:text-lg">
                        <Cell v={row.premium} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Reveal>

        {/* Ad budget notice — paired callout under the table */}
        <Reveal delay={0.2}>
          <div className="mt-6 flex flex-col items-start justify-between gap-6 rounded-2xl border border-accent/40 bg-accent/[0.06] p-6 backdrop-blur-sm md:flex-row md:items-center md:gap-10 md:p-8">
            <div>
              <div className="font-mono text-base font-medium text-accent">
                Wichtig zu wissen
              </div>
              <h4 className="mt-2 font-display text-2xl font-semibold tracking-tight md:text-3xl">
                Werbebudget ist extra.
              </h4>
              <p className="mt-3 text-lg leading-relaxed text-fg-primary md:text-xl">
                Sie zahlen Ihr Werbebudget direkt an Meta und Google, nicht an uns. Volle Transparenz über jeden Euro.
              </p>
            </div>
            <div className="shrink-0 text-left md:text-right">
              <div className="font-mono text-base text-fg-primary">Empfehlung</div>
              <div className="mt-1 whitespace-nowrap font-display text-3xl font-semibold tracking-tight md:text-4xl">
                min. 3.000 € / Monat
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
