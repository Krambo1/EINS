"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

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

        <Reveal delay={0.15}>
          <div className="relative mt-8 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:mt-12 md:p-12">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
              style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              aria-hidden
            />
            <div className="relative md:grid md:grid-cols-[1fr_auto] md:items-center md:gap-10 lg:gap-14">
              <div>
                <div className="font-mono text-base font-medium text-accent">
                  90-Tage-Garantie
                </div>
                <h3 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight md:text-5xl">
                  Kommen nicht genug Anfragen, zahlen wir drauf.
                </h3>
                <p className="mt-4 text-lg leading-relaxed text-fg-primary md:text-xl">
                  Unser Versprechen: Mindestens 10 ernsthafte Patientenanfragen pro 1.000 € Werbebudget innerhalb von 90 Tagen. Halten wir das nicht ein:
                </p>
                <ul className="mt-7 space-y-4 text-lg text-fg-primary md:text-xl">
                  <li className="flex items-start gap-3">
                    <Check className="mt-[0.3em] h-6 w-6 shrink-0 text-accent" />
                    <span>Monat 4 geht auf uns. Sie zahlen keine Gebühren.</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Check className="mt-[0.3em] h-6 w-6 shrink-0 text-accent" />
                    <span>Wir erstellen 3 neue Werbemittel für Sie, kostenlos.</span>
                  </li>
                </ul>
              </div>

              <div className="mt-8 flex w-full max-w-[220px] flex-col self-center md:mt-0 md:w-[220px] md:max-w-none lg:w-[240px]">
                <div className="relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-bg-secondary/80 backdrop-blur-sm">
                  <Image
                    src="/headshot.webp"
                    alt="Karam Issa, Gründer EINS Visuals"
                    fill
                    sizes="240px"
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
          </div>
        </Reveal>
      </div>
    </section>
  );
}

