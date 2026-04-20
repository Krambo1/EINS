"use client";

import { Check } from "lucide-react";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export function Guarantee() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
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
            <br />
            <span className="font-normal">nicht für Aktivität.</span>
          </h2>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-8 grid gap-6 md:mt-12 md:grid-cols-[1.5fr_1fr]">
            <div className="relative overflow-hidden rounded-3xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:p-12">
              <div
                className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
                style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
                aria-hidden
              />
              <div className="font-mono text-base font-medium text-accent">
                90-Tage-Garantie
              </div>
              <h3 className="mt-4 font-display text-3xl font-semibold leading-tight tracking-tight md:text-4xl">
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
                  <span>Wir produzieren 3 neue Videos für Sie, kostenlos.</span>
                </li>
              </ul>
            </div>

            <QualifiedRequestCard />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const QUALIFIED_BULLETS = [
  "Ausgefülltes Formular mit konkretem Behandlungswunsch (Implantat, Invisalign, Zahnersatz).",
  "Patient hat ein realistisches Budget angegeben.",
  "Bereit für ein Beratungsgespräch innerhalb der nächsten 30 Tage.",
  "Die KI hat die Anfrage als ernsthaft eingestuft.",
];

function QualifiedBullets() {
  return (
    <ul className="space-y-4 text-base leading-relaxed text-fg-primary md:text-lg">
      {QUALIFIED_BULLETS.map((b) => (
        <li key={b} className="flex gap-3">
          <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
          <span>{b}</span>
        </li>
      ))}
    </ul>
  );
}

function QualifiedRequestCard() {
  const title = `Was wir als „qualifizierte Anfrage" zählen:`;
  return (
    <div className="card-glow rounded-3xl border border-border bg-bg-secondary/60 backdrop-blur-sm">
      {/* Mobile: collapsible accordion, closed by default */}
      <div className="md:hidden">
        <Accordion type="single" collapsible>
          <AccordionItem value="definition" className="border-b-0">
            <AccordionTrigger className="px-6 py-5 text-left hover:text-fg-primary">
              <span className="font-display text-xl font-semibold tracking-tight text-balance">
                {title}
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6">
              <QualifiedBullets />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
      {/* Desktop: always-visible static card */}
      <div className="hidden p-8 md:block">
        <h4 className="font-display text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h4>
        <div className="mt-6">
          <QualifiedBullets />
        </div>
      </div>
    </div>
  );
}
