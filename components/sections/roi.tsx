"use client";

import { motion } from "framer-motion";
import { Reveal } from "@/components/ui/reveal";
import { RoiSlider } from "@/components/ui/roi-slider";
import { SCENARIOS } from "@/lib/offer-data";
import { formatEuro } from "@/lib/utils";

export function Roi() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Realistisches ROI: <span className="text-accent-gradient">Ø +247 %</span> in{" "}
            <span className="relative inline-block whitespace-nowrap">
              90 Tagen
              <motion.svg
                aria-hidden
                className="pointer-events-none absolute -bottom-2 left-0 h-[0.35em] w-full text-accent md:-bottom-3"
                viewBox="0 0 200 12"
                preserveAspectRatio="none"
                initial={{ pathLength: 0, opacity: 0 }}
                whileInView={{ pathLength: 1, opacity: 1 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
              >
                <motion.path
                  d="M 3 8 Q 80 3, 197 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  style={{ filter: "url(#pencil-roughen)" }}
                />
                <defs>
                  <filter id="pencil-roughen">
                    <feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="2" seed="3" />
                    <feDisplacementMap in="SourceGraphic" scale="1.6" />
                  </filter>
                </defs>
              </motion.svg>
            </span>.
          </h2>
        </Reveal>
        <Reveal delay={0.15}>
          <p className="mt-6 mx-auto max-w-2xl text-center text-lg text-fg-secondary">
            Basierend auf Ø LTV 4.500 EUR pro Implantat-Patient. Bei All-on-4 oder Vollsanierungen
            oft 8.000 bis 20.000 EUR pro Patient.
          </p>
        </Reveal>

        <Reveal delay={0.2}>
          <div className="mt-10">
            <RoiSlider />
          </div>
        </Reveal>

        <Reveal delay={0.15}>
          <div className="mt-12 overflow-x-auto rounded-2xl border border-border bg-bg-primary">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-6 py-4 font-mono text-base font-normal text-fg-secondary">
                    Szenario
                  </th>
                  <th className="px-6 py-4 text-right font-mono text-base font-normal text-fg-secondary">
                    Leads
                  </th>
                  <th className="px-6 py-4 text-right font-mono text-base font-normal text-fg-secondary">
                    Konversion
                  </th>
                  <th className="px-6 py-4 text-right font-mono text-base font-normal text-fg-secondary">
                    Patienten
                  </th>
                  <th className="px-6 py-4 text-right font-mono text-base font-normal text-fg-secondary">
                    Return · 90 Tage
                  </th>
                </tr>
              </thead>
              <tbody>
                {SCENARIOS.map((s) => (
                  <tr
                    key={s.label}
                    className={`border-b border-border last:border-b-0 ${
                      s.highlight ? "bg-accent/[0.06]" : ""
                    }`}
                  >
                    <td className="px-6 py-4">
                      <span
                        className={`font-display text-lg ${
                          s.highlight ? "text-accent" : "text-fg-primary"
                        }`}
                      >
                        {s.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-base text-fg-secondary">
                      {s.leads}
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-base text-fg-secondary">
                      {s.conversion}%
                    </td>
                    <td className="px-6 py-4 text-right font-mono text-base text-fg-secondary">
                      {s.patients}
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-mono text-base ${
                        s.highlight ? "text-accent" : "text-fg-primary"
                      }`}
                    >
                      {formatEuro(s.returnEur)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <p className="mt-6 font-mono text-base text-fg-secondary">
          Basierend auf Ø LTV 4.500 EUR pro Implantat-Patient. Bei All-on-4 oder Vollsanierungen
          oft 8.000 bis 20.000 EUR pro Patient.
        </p>
      </div>
    </section>
  );
}
