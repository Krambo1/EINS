import { Check, Minus, Lock } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "@/components/ui/reveal";
import { PortalTabShowcase } from "@/components/ui/portal-tab-showcase";
import {
  BASISPAKET,
  RETAINER_ROWS,
  TIERS,
  type RetainerRow,
  type Tier,
} from "@/lib/offer-data";

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
  return <span className="text-sm text-fg-primary md:text-lg">{v}</span>;
}

type TierKey = "standard" | "erweitert" | "premium";

// Mobile tier card. The first card lists every row from RETAINER_ROWS so the
// reader sees the full Standard scope. Each subsequent card shows only the
// rows whose value differs from the tier directly below it, plus an "Alles
// in <previous>" anchor at the top. This keeps the cards short while making
// the upgrade story obvious.
function TierCardMobile({
  tier,
  mode,
}: {
  tier: Tier;
  mode: "full" | "diff-from-standard" | "diff-from-erweitert";
}) {
  const valueKey: TierKey =
    mode === "full"
      ? "standard"
      : mode === "diff-from-standard"
      ? "erweitert"
      : "premium";

  const rows: RetainerRow[] =
    mode === "full"
      ? RETAINER_ROWS.filter((row) => row.standard !== false)
      : mode === "diff-from-standard"
      ? RETAINER_ROWS.filter((row) => row.standard !== row.erweitert)
      : RETAINER_ROWS.filter((row) => row.erweitert !== row.premium);

  const referenceLabel =
    mode === "diff-from-standard"
      ? "Alles in Standard"
      : mode === "diff-from-erweitert"
      ? "Alles in Erweitert"
      : null;

  const cardClass = tier.highlight
    ? "card-glow relative rounded-2xl border border-accent/50 bg-accent/[0.04] p-5 backdrop-blur-sm"
    : "card-glow relative rounded-2xl border border-border bg-bg-secondary/60 p-5 backdrop-blur-sm";

  return (
    <div className={cardClass}>
      {tier.badge ? (
        <span className="absolute -top-3 left-5 whitespace-nowrap rounded-full bg-accent px-3 py-0.5 font-mono text-xs font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.25)]">
          {tier.badge}
        </span>
      ) : null}
      <div className="font-mono text-3xl font-semibold text-fg-primary">
        {tier.name}
      </div>
      <p className="mt-3 text-base text-fg-primary">{tier.description}</p>
      <ul className="mt-4 space-y-3 text-base text-fg-primary">
        {referenceLabel ? (
          <li className="flex items-start gap-3">
            <Check className="mt-1 h-4 w-4 shrink-0 text-accent" />
            <span className="flex-1 font-semibold">{referenceLabel}</span>
          </li>
        ) : null}
        {rows.map((row) => {
          const v = row[valueKey];
          if (v === false) {
            return (
              <li
                key={row.label}
                className="flex items-start gap-3 text-fg-secondary"
              >
                <Minus className="mt-1 h-4 w-4 shrink-0 text-fg-tertiary" />
                <span className="flex-1">{row.label}</span>
              </li>
            );
          }
          return (
            <li key={row.label} className="flex items-start gap-3">
              <Check className="mt-1 h-4 w-4 shrink-0 text-accent" />
              <span className="flex-1">
                {row.label}
                {typeof v === "string" ? (
                  <span className="block text-sm text-fg-secondary">{v}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Offer() {
  return (
    <section id="angebot" className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="whitespace-nowrap">Das EINS</span>{" "}
            Akquisitions-System.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 mx-auto max-w-2xl text-center text-lg text-fg-primary">
            Alles, was Sie brauchen, damit Patienten sich nicht mehr wegen des Preises entscheiden,
            sondern weil sie Ihnen vertrauen.
          </p>
        </Reveal>

        {/* Basispaket */}
        <Reveal delay={0.2}>
          <div className="card-glow mt-10 rounded-2xl border border-border bg-bg-secondary/60 p-5 backdrop-blur-sm md:mt-16 md:p-10">
            <div>
              <h3 className="font-display text-4xl font-semibold tracking-tight md:text-5xl">
                Professioneller Klinik-Auftritt
              </h3>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="font-mono text-base text-fg-primary">Basispaket</span>
                <span className="rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 font-mono text-base font-semibold text-accent">
                  Einmalzahlung
                </span>
              </div>
            </div>

            <Accordion type="single" collapsible className="mt-8">
              {BASISPAKET.map((item) => (
                <AccordionItem key={item.id} value={item.id}>
                  <AccordionTrigger>
                    <div className="flex min-w-0 flex-1 items-center gap-6">
                      <span className="hidden font-mono text-base text-fg-secondary md:inline">{item.number}</span>
                      <span className="font-display text-lg tracking-tight md:text-xl">
                        {item.title}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-3 text-base leading-relaxed md:pl-[60px]">
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

        {/* Ad budget notice, placed above the pricing table so the cost picture is honest up-front. */}
        <Reveal delay={0.18}>
          <div className="mt-6 rounded-2xl border border-accent/40 bg-accent/[0.06] p-6 backdrop-blur-sm md:mt-10 md:p-8">
            <div className="font-mono text-base font-medium text-accent">
              Wichtig zu wissen
            </div>
            <h4 className="mt-2 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              Werbebudget ist extra.
            </h4>
            <p className="mt-3 text-lg leading-relaxed text-fg-primary md:text-xl">
              Sie zahlen Ihr Werbebudget direkt an Meta und Google, nicht an uns. Volle Transparenz über jeden Euro.
            </p>
          </div>
        </Reveal>

        {/* Retainer comparison */}
        <Reveal delay={0.15}>
          <div className="mt-12">
            <h3 className="text-center font-display text-4xl font-semibold tracking-tight md:text-5xl">
              Standard, Erweitert, Premium.
            </h3>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              <span className="font-mono text-base text-fg-primary">Patienten-Wachstumsmanagement</span>
              <span className="rounded-full border border-accent/40 bg-accent/10 px-3.5 py-1 font-mono text-base font-semibold text-accent">
                Monatlich
              </span>
            </div>

            {/* Mobile: horizontal swipe carousel. Order is Standard, Erweitert, Premium so
                the recommended tier sits in the middle. Cards are 85% width so the next
                one peeks in, signalling the swipe affordance without dots/JS state. */}
            <div className="-mx-4 mt-10 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-4 pt-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden">
              <div className="snap-center shrink-0 basis-[85%]">
                <TierCardMobile tier={TIERS[0]} mode="full" />
              </div>
              <div className="snap-center shrink-0 basis-[85%]">
                <TierCardMobile tier={TIERS[1]} mode="diff-from-standard" />
              </div>
              <div className="snap-center shrink-0 basis-[85%]">
                <TierCardMobile tier={TIERS[2]} mode="diff-from-erweitert" />
              </div>
            </div>

            {/* Desktop: full comparison table with tier names in the header row. */}
            <div className="mt-10 hidden rounded-2xl border border-border md:block">
              <table className="w-full table-fixed border-collapse text-left">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[22%]" />
                  <col className="w-[22%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border">
                    <th className="rounded-tl-2xl bg-bg-secondary px-6 py-6 align-bottom font-mono text-base font-normal text-fg-primary">
                      Komponente
                    </th>
                    {TIERS.map((tier, i) => {
                      const isLast = i === TIERS.length - 1;
                      return (
                        <th
                          key={tier.id}
                          className={
                            "relative border-l border-border bg-bg-secondary px-4 py-6 text-center align-bottom" +
                            (isLast ? " rounded-tr-2xl" : "") +
                            (tier.highlight ? " bg-accent/[0.06]" : "")
                          }
                        >
                          {tier.badge ? (
                            <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-3 py-0.5 font-mono text-xs font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.25)]">
                              {tier.badge}
                            </span>
                          ) : null}
                          <div className="font-mono text-3xl font-semibold text-fg-primary">
                            {tier.name}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {RETAINER_ROWS.map((row) => (
                    <tr
                      key={row.label}
                      className="border-b border-border last:border-b-0"
                    >
                      <td className="break-words px-6 py-4 text-base text-fg-primary md:text-lg">
                        {row.label}
                      </td>
                      <td className="border-l border-border px-4 py-4 text-center text-lg">
                        <Cell v={row.standard} />
                      </td>
                      <td className="border-l border-border bg-accent/[0.04] px-4 py-4 text-center text-lg">
                        <Cell v={row.erweitert} />
                      </td>
                      <td className="border-l border-border px-4 py-4 text-center text-lg">
                        <Cell v={row.premium} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tier descriptions: shown below the desktop table since each card on
                mobile already carries its own description. Column widths mirror the
                table's colgroup (34% / 22% / 22% / 22%) so each blurb sits under its
                tier header. */}
            <div className="mt-6 hidden grid-cols-[34%_22%_22%_22%] md:grid">
              <div aria-hidden />
              {TIERS.map((tier) => (
                <p
                  key={tier.id}
                  className={
                    "px-4 text-center text-sm leading-relaxed text-fg-primary " +
                    (tier.highlight ? "font-medium" : "")
                  }
                >
                  <span className="font-mono font-semibold text-fg-primary">
                    {tier.name}.
                  </span>{" "}
                  {tier.description}
                </p>
              ))}
            </div>

            {/* EINS Portal showcase. Sits inside the Standard/Erweitert/Premium
                block so the portal reads as a pillar of every tier, not a
                separate upsell. Tabs swap between live screenshots so clinics
                see what they get rather than reading another bullet list. */}
            <Reveal delay={0.1}>
              <div className="card-glow relative mt-12 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary/60 to-bg-secondary/40 p-3 backdrop-blur-sm md:mt-16 md:p-12">
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
                />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent to-transparent" />

                <div className="relative mx-auto max-w-3xl text-center">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-accent">
                      In allen Paketen enthalten
                    </span>
                    <span className="inline-flex items-center gap-1.5 font-mono text-xs text-fg-secondary">
                      <Lock className="h-3 w-3" aria-hidden />
                      Privater Klinik-Zugang
                    </span>
                  </div>
                  <h4 className="mt-5 font-display text-4xl font-semibold tracking-tight md:text-6xl">
                    Ihr EINS Portal.
                  </h4>
                  <p className="mt-5 text-lg leading-relaxed text-fg-primary md:text-xl">
                    Volle Transparenz, 24/7. Sehen Sie jede Anfrage, jeden Euro
                    Werbebudget und jedes Ergebnis in Echtzeit, statt auf den
                    Monatsreport zu warten.
                  </p>
                </div>

                <div className="relative mt-5 md:mt-14">
                  <PortalTabShowcase />
                </div>
              </div>
            </Reveal>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
