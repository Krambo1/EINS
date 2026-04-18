"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CALENDLY_URL, ACTIVE_CLINICS } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative flex min-h-[100svh] items-center overflow-hidden pb-16 pt-32 md:pt-40">
      <div className="container">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-7xl mx-auto text-center"
        >
          <h1 className="display-xl">
            Mehr Patienten.
            <br />
            Mehr Umsatz.
            <br />
            <span className="relative inline-block text-accent-gradient">
              Planbares Wachstum.
              <motion.span
                className="absolute -bottom-1 left-0 h-[3px] w-full bg-accent/50"
                initial={{ scaleX: 0, transformOrigin: "left" }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.9, delay: 0.7, ease: [0.16, 1, 0.3, 1] }}
              />
            </span>
          </h1>

          <p className="mt-10 mx-auto max-w-[60ch] text-lg leading-relaxed text-fg-secondary md:text-xl">
            Das komplette Akquisitions-System für Zahn- und Ästhetikkliniken im DACH-Raum.
            Video, Paid Ads und <span className="text-fg-primary">KI-gestützte Lead-Infrastruktur</span>, als ein einziges integriertes Produkt.
          </p>

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
              Strategie-Call buchen <ArrowUpRight className="h-5 w-5" />
            </ShinyButton>
            <Button asChild size="lg" variant="outline">
              <a href="#system">System ansehen</a>
            </Button>
          </div>

          <div className="mt-14 flex items-center justify-center divide-x divide-border">
            <div className="flex flex-col items-center px-6 sm:px-10">
              <div className="font-display text-2xl font-medium tracking-tight text-fg-primary md:text-3xl">
                {ACTIVE_CLINICS}
              </div>
              <div className="mt-1 text-xs text-fg-secondary md:text-sm">
                aktive Kliniken
              </div>
            </div>
            <div className="flex flex-col items-center px-6 sm:px-10">
              <div className="font-display text-2xl font-medium tracking-tight text-fg-primary md:text-3xl">
                +247%
              </div>
              <div className="mt-1 text-xs text-fg-secondary md:text-sm">
                Ø ROI in 90 Tagen
              </div>
            </div>
            <div className="flex flex-col items-center px-6 sm:px-10">
              <div className="font-display text-2xl font-medium tracking-tight text-fg-primary md:text-3xl">
                1
              </div>
              <div className="mt-1 text-xs text-fg-secondary md:text-sm">
                Onboarding / Monat
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
