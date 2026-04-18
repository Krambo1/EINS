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
        <Check className="h-5 w-5 text-accent" />
      </div>
    );
  if (v === false)
    return (
      <div className="flex justify-center">
        <Minus className="h-5 w-5 text-fg-secondary" />
      </div>
    );
  return <span className="text-lg text-fg-primary">{v}</span>;
}

export function Offer() {
  return (
    <section id="angebot" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">EINS Premium Akquisitions System.</h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 mx-auto max-w-2xl text-center text-lg text-fg-secondary">
            Was Sie wirklich kaufen: die komplette Marketing-Infrastruktur, die hochpreisige
            Behandlungen von Preisvergleich zu Vertrauenskauf transformiert.
          </p>
        </Reveal>

        {/* Basispaket */}
        <Reveal delay={0.2}>
          <div className="card-glow mt-16 rounded-3xl border border-border bg-bg-secondary p-6 md:p-10">
            <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-center">
              <div>
                <div className="font-mono text-base text-fg-secondary">
                  Basispaket · einmalig
                </div>
                <h3 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
                  Professioneller Praxis-Auftritt
                </h3>
              </div>
              <div className="text-right">
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
            <div className="text-center font-mono text-base text-fg-secondary">
              Patienten-Wachstumsmanagement · monatlich
            </div>
            <h3 className="mt-2 text-center font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Standard vs. Premium
            </h3>

            <div className="mt-8 overflow-x-auto rounded-2xl border border-border">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-bg-secondary">
                    <th className="px-6 py-4 font-mono text-lg font-normal text-fg-secondary">
                      Komponente
                    </th>
                    <th className="px-6 py-4 text-center font-mono text-lg font-normal text-fg-secondary">
                      Standard
                    </th>
                    <th className="px-6 py-4 text-center">
                      <div className="inline-flex items-center gap-2">
                        <span className="font-mono text-lg text-fg-primary">
                          Premium
                        </span>
                        <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-xs font-medium text-bg-primary">
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
                      <td className="px-6 py-4 text-lg text-fg-secondary">{row.label}</td>
                      <td className="px-6 py-4 text-center">
                        <Cell v={row.standard} />
                      </td>
                      <td className="px-6 py-4 text-center">
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
            <div className="card-glow rounded-2xl border border-border bg-bg-secondary p-6">
              <div className="font-mono text-base text-fg-secondary">
                Performance-basierte Lead-Vergütung
              </div>
              <div className="mt-5 space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-base text-fg-secondary">Lead 1 bis 50</span>
                  <span className="font-mono text-xl text-fg-primary">39 EUR / Lead</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-base text-fg-secondary">Ab Lead 51+</span>
                  <span className="font-mono text-xl text-accent-gradient">29 EUR / Lead</span>
                </div>
              </div>
              <p className="mt-5 text-base leading-relaxed text-fg-secondary">
                Wir verdienen mehr, wenn wir performen. Fair und skalierbar.
              </p>
            </div>
            <div className="card-glow rounded-2xl border border-border bg-bg-secondary p-6">
              <div className="font-mono text-base text-fg-secondary">
                Werbebudget (Adspend)
              </div>
              <div className="mt-5 font-display text-3xl font-semibold tracking-tight">
                min. 3.000 EUR / Monat
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
