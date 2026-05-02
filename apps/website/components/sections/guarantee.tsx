"use client";

import Image from "next/image";
import { useState } from "react";
import { motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { cn } from "@/lib/utils";

const STACK = [
  {
    n: 1,
    title: "100 % Geld zurück bei verfehltem Ziel",
    body: "Erreichen wir die vereinbarte Anfragen-Schwelle in 90 Tagen nicht, erstatten wir alle bis dahin gezahlten Gebühren an EINS. Vollständig, ohne Diskussion.",
  },
  {
    n: 2,
    title: "Kein Aufbau-Risiko",
    body: "Sie zahlen für die Aufbauarbeit erst, wenn die ersten qualifizierten Anfragen bei Ihnen liegen. Vorab kein Setup-Betrag fällig.",
  },
  {
    n: 3,
    title: "Wir arbeiten kostenlos weiter, bis das Ziel steht",
    body: "Falls 90 Tage nicht reichen, betreuen wir Sie so lange unentgeltlich, bis die Schwelle erreicht ist.",
  },
  {
    n: 4,
    title: "Geschwindigkeits-Garantie: erste Anfragen in 21 Tagen",
    body: "Liegt nach drei Wochen ab Kampagnen-Launch keine einzige qualifizierte Anfrage vor, erlassen wir den nächsten Monat komplett.",
  },
  {
    n: 5,
    title: "Frei kündbar, jederzeit",
    body: "Sie können monatlich kündigen, vom ersten Tag an. Keine 12-Monats-Bindung, keine Mindestlaufzeit.",
  },
  {
    n: 6,
    title: "Direkt vom Gründer betreut",
    body: "Kein Junior-Account-Manager, kein Praktikant, keine Outsourcing-Schiene. Sie arbeiten persönlich mit dem Gründer an Ihrer Kampagne.",
  },
];

export function Guarantee() {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            <span className="block">
              Wir tragen das{" "}
              <span className="relative inline-block whitespace-nowrap">
                Risiko
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
              .
            </span>
          </h2>
        </Reveal>

        <Reveal delay={0.18}>
          <div className="relative mt-8 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:mt-12 md:p-12">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
              style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              aria-hidden
            />

            <div className="relative md:grid md:grid-cols-[1fr_auto] md:items-start md:gap-x-10 lg:gap-x-14">
              <div className="md:col-span-2">
                <h3 className="font-display text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
                  100&nbsp;% Geld-zurück-Garantie.
                </h3>
                <p className="mt-5 max-w-2xl text-lg leading-relaxed text-fg-primary md:text-xl">
                  Die ersten zwei Kliniken, mit denen wir in Q3 2026 starten, bekommen die stärkste Garantie, die wir je geben werden. Mehrfach abgesichert, ohne Vorleistung Ihrerseits.
                </p>
              </div>

              <ul className="mt-8 flex flex-col gap-0 md:mt-12 md:grid md:grid-cols-2 md:gap-x-10 md:gap-y-8">
                  {STACK.map((item) => {
                    const isOpen = openId === item.n;
                    return (
                      <li
                        key={item.n}
                        className="border-b border-border/60 last:border-b-0 md:flex md:gap-4 md:border-0"
                      >
                        <div className="hidden font-mono text-sm font-medium text-accent md:block md:text-base">
                          {item.n}.
                        </div>
                        <div className="flex-1">
                          <button
                            type="button"
                            onClick={() => setOpenId(isOpen ? null : item.n)}
                            aria-expanded={isOpen}
                            className="flex w-full items-start gap-3 py-4 text-left md:hidden"
                          >
                            <span className="font-mono text-sm font-medium text-accent">
                              {item.n}.
                            </span>
                            <span className="flex-1 font-display text-lg font-semibold leading-snug tracking-tight text-fg-primary">
                              {item.title}
                            </span>
                            <ChevronDown
                              className={cn(
                                "mt-1 h-5 w-5 shrink-0 text-fg-secondary transition-transform",
                                isOpen && "rotate-180"
                              )}
                              aria-hidden
                            />
                          </button>
                          <div className="hidden font-display text-xl font-semibold leading-snug tracking-tight text-fg-primary md:block">
                            {item.title}
                          </div>
                          <div
                            className={cn(
                              "overflow-hidden md:block md:overflow-visible",
                              isOpen ? "block" : "hidden"
                            )}
                          >
                            <p className="pb-4 pl-7 text-base leading-relaxed text-fg-primary md:mt-2 md:pb-0 md:pl-0 md:text-lg">
                              {item.body}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>

              <div className="mt-3 self-start md:mt-12 md:w-[240px] lg:w-[260px]">
                {/* Mobile: image bleeds to bottom-left edge of outer card */}
                <div className="-mx-6 -mb-6 flex md:hidden">
                  <div className="relative aspect-[3/4] w-44 shrink-0 self-end overflow-hidden">
                    <Image
                      src="/headshot.webp"
                      alt="Karam Issa, Gründer EINS Visuals"
                      fill
                      sizes="176px"
                      className="object-contain object-bottom"
                    />
                  </div>
                  <div className="flex flex-1 flex-col justify-center py-5 pl-5 pr-6">
                    <div className="font-mono text-xs uppercase tracking-wide text-accent">
                      Kapazität
                    </div>
                    <div className="mt-1 font-display text-2xl font-semibold text-fg-primary">
                      2 Plätze
                    </div>
                    <div className="font-mono text-sm text-fg-secondary">
                      Q3 2026
                    </div>
                    <div className="mt-4 -ml-3 relative h-10 w-28">
                      <Image
                        src="/Signature.png"
                        alt="Unterschrift Karam Issa"
                        fill
                        sizes="112px"
                        className="object-contain object-left"
                      />
                    </div>
                    <div className="mt-1 font-display text-base font-semibold leading-tight text-fg-primary">
                      Karam Issa
                    </div>
                    <div className="text-sm leading-tight text-fg-secondary">
                      Gründer
                    </div>
                  </div>
                </div>

                {/* Desktop: stacked Kapazität + large image */}
                <div className="hidden md:block">
                  <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-4">
                    <div className="font-mono text-xs uppercase tracking-wide text-accent">
                      Kapazität
                    </div>
                    <div className="mt-1 font-display text-2xl font-semibold text-fg-primary md:text-3xl">
                      2 Plätze
                    </div>
                    <div className="font-mono text-sm text-fg-secondary">
                      Q3 2026
                    </div>
                  </div>

                  <div className="mt-5 relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-white">
                    <Image
                      src="/headshot.webp"
                      alt="Karam Issa, Gründer EINS Visuals"
                      fill
                      sizes="260px"
                      className="object-contain"
                    />
                  </div>
                  <div className="mt-3 flex flex-col items-center px-1 text-center">
                    <div className="relative h-12 w-32">
                      <Image
                        src="/Signature.png"
                        alt="Unterschrift Karam Issa"
                        fill
                        sizes="128px"
                        className="object-contain"
                      />
                    </div>
                    <div className="mt-1 font-display text-base font-semibold text-fg-primary md:text-lg">
                      Karam Issa
                    </div>
                    <div className="text-sm text-fg-secondary">
                      Gründer, EINS Visuals
                    </div>
                  </div>
                </div>
              </div>
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
