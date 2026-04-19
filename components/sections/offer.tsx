import { Check, Minus } from "lucide-react";
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
          <div className="card-glow mt-16 rounded-3xl border border-border bg-bg-secondary p-5 md:p-10">
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
                  <AccordionTrigger>
                    <div className="flex items-center gap-6">
                      <span className="font-mono text-base text-fg-secondary">{item.number}</span>
                      <span className="font-display text-lg tracking-tight md:text-xl">
                        {item.title}
                      </span>
                    </div>
                    <span className="ml-auto mr-4 font-mono text-base text-fg-secondary">
                      Wert: {formatEuro(item.value)}
                    </span>
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
              Standard vs. Erweitert
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
                    <th className="px-3 py-3 text-center font-mono text-sm font-normal text-fg-primary md:px-6 md:py-4 md:text-lg">
                      Standard
                    </th>
                    <th className="px-3 py-3 text-center md:px-6 md:py-4">
                      <div className="inline-flex flex-col items-center gap-1 md:flex-row md:gap-2">
                        <span className="font-mono text-base text-fg-primary md:text-lg">
                          Erweitert
                        </span>
                        <span className="rounded-full bg-accent px-1.5 py-0.5 font-mono text-[10px] font-medium text-bg-primary md:px-2 md:text-xs">
                          Empfohlen
                        </span>
                      </div>
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

        {/* Performance-based leads */}
        <Reveal delay={0.2}>
          <div className="mt-10 grid gap-6 md:grid-cols-2">
            <div className="card-glow rounded-2xl border border-border bg-bg-secondary p-5 md:p-6">
              <div className="font-mono text-base text-fg-secondary">
                Erfolgsabhängige Vergütung pro Anfrage
              </div>
              <div className="mt-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-base text-fg-secondary">Anfrage 1 bis 50</span>
                  <span className="font-mono text-xl text-fg-primary">39 € / Anfrage</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-base text-fg-secondary">Ab Anfrage 51+</span>
                  <span className="font-mono text-xl text-accent-gradient">29 € / Anfrage</span>
                </div>
              </div>
              <p className="mt-5 text-base leading-relaxed text-fg-secondary">
                Wir verdienen mehr, wenn wir liefern. Fair und planbar.
              </p>
            </div>
            <div className="card-glow rounded-2xl border border-border bg-bg-secondary p-5 md:p-6">
              <div className="font-mono text-base text-fg-secondary">
                Werbebudget
              </div>
              <div className="mt-5 font-display text-3xl font-semibold tracking-tight">
                min. 3.000 € / Monat
              </div>
              <p className="mt-5 text-base leading-relaxed text-fg-secondary">
                Direkt an die Plattformen (Meta, Google), separat von Agenturgebühren. Volle Transparenz
                über jeden ausgegebenen Euro.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
