"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";

const STACK = [
  {
    n: 1,
    title: "100 % Geld zurück bei verfehltem Ziel",
    body: "Erreichen wir die vereinbarte Anfragen-Schwelle in 90 Tagen nicht, erstatten wir alle bis dahin gezahlten Gebühren an EINS. Vollständig, ohne Diskussion.",
  },
  {
    n: 2,
    title: "Frei kündbar, jederzeit",
    body: "Sie können monatlich kündigen, vom ersten Tag an. Keine 12-Monats-Bindung, keine Mindestlaufzeit.",
  },
];

export function Guarantee() {
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
          <div className="relative mt-8 overflow-hidden rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/[0.08] via-bg-secondary to-bg-secondary p-6 md:mx-auto md:mt-12 md:max-w-3xl md:p-8 lg:max-w-4xl lg:p-10">
            <div
              className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
              style={{ background: "radial-gradient(circle, var(--accent-glow), transparent 60%)" }}
              aria-hidden
            />

            <div className="relative md:flex md:items-stretch md:gap-x-6 lg:gap-x-8">
              <div className="md:flex-1">
                <ul className="flex flex-col gap-10 md:gap-y-12">
                  {STACK.map((item) => (
                    <li key={item.n} className="md:flex md:gap-5">
                      <div className="hidden font-mono text-base font-medium text-accent md:block md:text-lg md:pt-1.5">
                        {item.n}.
                      </div>
                      <div className="md:max-w-xl">
                        <div className="flex items-start gap-3 md:block">
                          <span className="font-mono text-sm font-medium text-accent md:hidden">
                            {item.n}.
                          </span>
                          <h3 className="flex-1 font-display text-xl font-semibold leading-snug tracking-tight text-fg-primary md:text-3xl lg:text-4xl">
                            {item.title}
                          </h3>
                        </div>
                        <p className="mt-2 pl-7 text-base leading-relaxed text-fg-primary md:mt-4 md:max-w-md md:pl-0 md:text-lg lg:text-xl">
                          {item.body}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-3 self-start md:-mt-2 md:w-[190px] md:shrink-0 lg:w-[210px]">
                {/* Mobile: image bleeds to bottom-left edge of outer card */}
                <div className="-mr-6 -mb-6 flex md:hidden">
                  <div className="relative aspect-[3/4] w-44 shrink-0 self-end overflow-hidden">
                    <Image
                      src="/headshot.webp"
                      alt="Karam Issa, Gründer EINS"
                      fill
                      sizes="176px"
                      className="object-contain object-bottom"
                    />
                  </div>
                  <div className="flex flex-1 flex-col justify-center py-5 pl-6 pr-6">
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
                  <div className="rounded-xl border border-accent/40 bg-accent/[0.06] p-3">
                    <div className="font-mono text-[11px] uppercase tracking-wide text-accent">
                      Kapazität
                    </div>
                    <div className="mt-0.5 font-display text-xl font-semibold text-fg-primary lg:text-2xl">
                      2 Plätze
                    </div>
                    <div className="font-mono text-xs text-fg-secondary">
                      Q3 2026
                    </div>
                  </div>

                  <div className="mt-4 relative aspect-[3/4] overflow-hidden rounded-xl border border-border bg-white">
                    <Image
                      src="/headshot.webp"
                      alt="Karam Issa, Gründer EINS"
                      fill
                      sizes="210px"
                      className="object-contain"
                    />
                  </div>
                  <div className="mt-2 flex flex-col items-center px-1 text-center">
                    <div className="relative h-10 w-28">
                      <Image
                        src="/Signature.png"
                        alt="Unterschrift Karam Issa"
                        fill
                        sizes="112px"
                        className="object-contain"
                      />
                    </div>
                    <div className="mt-0.5 font-display text-sm font-semibold text-fg-primary lg:text-base">
                      Karam Issa
                    </div>
                    <div className="text-xs text-fg-secondary">
                      Gründer, EINS
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
