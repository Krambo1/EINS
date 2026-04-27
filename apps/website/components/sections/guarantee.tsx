"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

const STACK = [
  {
    n: "01",
    title: "Kein Aufbau-Risiko",
    body: "Sie zahlen für die Aufbauarbeit erst, wenn die ersten qualifizierten Anfragen bei Ihnen liegen. Vorab kein Setup-Betrag fällig.",
  },
  {
    n: "02",
    title: "100 % Geld zurück bei verfehltem Ziel",
    body: "Erreichen wir die vereinbarte Anfragen-Schwelle in 90 Tagen nicht, erstatten wir alle bis dahin gezahlten Gebühren. Vollständig, ohne Diskussion.",
  },
  {
    n: "03",
    title: "Wir arbeiten kostenlos weiter, bis das Ziel steht",
    body: "Falls 90 Tage nicht reichen, betreuen wir Sie so lange unentgeltlich, bis die Schwelle erreicht ist.",
  },
  {
    n: "04",
    title: "Geschwindigkeits-Garantie: erste Anfragen in 21 Tagen",
    body: "Liegt nach drei Wochen ab Kampagnen-Launch keine einzige qualifizierte Anfrage vor, erlassen wir den nächsten Monat komplett.",
  },
  {
    n: "05",
    title: "Kein Lock-in ab Tag 1",
    body: "Sie können monatlich kündigen, vom ersten Tag an. Keine 12-Monats-Bindung, keine Mindestlaufzeit.",
  },
  {
    n: "06",
    title: "Direkt vom Gründer betreut",
    body: "Kein Junior-Account-Manager, kein Praktikant, keine Outsourcing-Schiene. Sie arbeiten persönlich mit Karam Issa, dem Gründer, an Ihrer Kampagne.",
  },
];

const COUNTER_ASKS = [
  "Einen Produktionstag in Ihrer Klinik (4–6 h)",
  "Freigabe für Case-Study und Testimonial nach Tag 90",
  "Namentliche Nennung als Referenz (Logo, Klinikname, optional Foto)",
];

export function Guarantee() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="block">
              Sie zahlen für{" "}
              <span className="relative inline-block whitespace-nowrap">
                Ergebnisse
                <motion.svg
                  aria-hidden
                  className="pointer-events-none absolute -bottom-2 left-0 h-[0.4em] w-full text-accent md:-bottom-3"
                  viewBox="0 0 200 20"
                  preserveAspectRatio="none"
                  initial={{ pathLength: 0, opacity: 0 }}
                  whileInView={{ pathLength: 1, opacity: 1 }}
                  viewport={{ once: true, margin: "-80px" }}
                  transition={{ duration: 1.2, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
                >
                  <motion.path
                    d="M 4 13 Q 100 7, 196 13"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ filter: "url(#pencil-roughen-2)" }}
                  />
                  <defs>
                    <filter id="pencil-roughen-2">
                      <feTurbulence type="fractalNoise" baseFrequency="2.1" numOctaves="2" seed="7" />
                      <feDisplacementMap in="SourceGraphic" scale="2" />
                    </filter>
                  </defs>
                </motion.svg>
              </span>
              ,
            </span>
            <span className="block font-normal">nicht für Aktivität.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.12}>
          <p className="mx-auto mt-6 max-w-3xl text-center font-mono text-base text-accent md:mt-8 md:text-lg">
            Garantie für die ersten zwei Mandate in Q3 2026
          </p>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="relative mt-8 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:mt-12 md:p-12">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
              style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              aria-hidden
            />

            <div className="relative md:grid md:grid-cols-[1fr_auto] md:items-start md:gap-10 lg:gap-14">
              <div>
                <h3 className="font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                  Wir tragen das Risiko. Sie tragen die Patienten.
                </h3>
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fg-primary md:text-xl">
                  Die ersten zwei Kliniken, mit denen wir in Q3 2026 starten, bekommen die stärkste Garantie, die wir je geben werden. Mehrfach abgesichert, ohne Vorleistung Ihrerseits.
                </p>
              </div>

              <div className="mt-8 flex w-full max-w-[260px] flex-col self-start md:mt-0 md:w-[240px] md:max-w-none lg:w-[260px]">
                <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
                  <div className="font-mono text-xs uppercase tracking-wide text-accent">
                    Kontingent
                  </div>
                  <div className="mt-1 font-display text-2xl font-semibold text-fg-primary md:text-3xl">
                    2 Plätze
                  </div>
                  <div className="font-mono text-sm text-fg-secondary">
                    Q3 2026 · 0 vergeben
                  </div>
                </div>

                <div className="mt-5 relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-bg-secondary/80 backdrop-blur-sm">
                  <Image
                    src="/headshot.webp"
                    alt="Karam Issa, Gründer EINS Visuals"
                    fill
                    sizes="260px"
                    className="object-contain"
                  />
                </div>
                <div className="mt-3 px-1">
                  <div className="font-display text-base font-semibold text-fg-primary md:text-lg">
                    Karam Issa
                  </div>
                  <div className="text-sm text-fg-secondary">
                    Gründer, EINS Visuals
                  </div>
                </div>
              </div>
            </div>

            <ul className="relative mt-10 grid gap-6 md:mt-12 md:grid-cols-2 md:gap-x-10 md:gap-y-8">
              {STACK.map((item) => (
                <li key={item.n} className="flex gap-4">
                  <div className="font-mono text-sm font-medium text-accent md:text-base">
                    {item.n}
                  </div>
                  <div>
                    <div className="font-display text-lg font-semibold leading-snug tracking-tight text-fg-primary md:text-xl">
                      {item.title}
                    </div>
                    <p className="mt-2 text-base leading-relaxed text-fg-primary md:text-lg">
                      {item.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>

            <div className="relative mt-10 border-t border-border/60 pt-8 md:mt-12">
              <div className="font-mono text-sm uppercase tracking-wide text-fg-secondary">
                Was wir im Gegenzug erwarten
              </div>
              <p className="mt-3 max-w-3xl text-base leading-relaxed text-fg-primary md:text-lg">
                Diese Bedingungen sind kein Almosen, sondern ein fairer Tausch. Wir bauen mit Ihnen zusammen die Referenzen auf, die unsere Arbeit für 2027 sichtbar machen.
              </p>
              <ul className="mt-4 grid gap-2 md:grid-cols-3 md:gap-6">
                {COUNTER_ASKS.map((ask) => (
                  <li
                    key={ask}
                    className="text-base leading-relaxed text-fg-primary md:text-lg"
                  >
                    {ask}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.22}>
          <p className="mx-auto mt-6 max-w-3xl text-center text-sm leading-relaxed text-fg-secondary md:mt-8">
            Konditionen werden im Strategie-Call individuell festgelegt. Garantie-Bedingungen werden vor Beauftragung schriftlich fixiert.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
