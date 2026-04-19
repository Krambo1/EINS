"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShinyButton } from "@/components/ui/shiny-button";
import { CALENDLY_URL } from "@/lib/constants";

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
          <h1 className="display-xl leading-[1.05]">
            Mehr Patienten.
            <br />
            Mehr Umsatz.
            <br />
            <span className="text-accent-gradient">Mehr Sicherheit.</span>
          </h1>

          <p className="mt-6 mx-auto max-w-[52ch] text-lg leading-snug text-fg-primary md:mt-10 md:text-xl lg:text-2xl">
            Medienproduktion, bezahlte Anzeigen und
            <br />
            KI-gestütztes Anfrage-System für Kliniken.
          </p>

          <div id="hero-cta" className="mt-6 flex flex-wrap items-start justify-center gap-4 md:mt-10">
            <div className="flex flex-col items-center gap-2">
              <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
                Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
              </ShinyButton>
              <span className="font-mono text-sm text-fg-tertiary">
                Unverbindlich · 30 Minuten · Persönlich
              </span>
            </div>
            <Button asChild size="lg" variant="outline" className="hidden md:inline-flex">
              <a href="#system">System ansehen</a>
            </Button>
          </div>

        </motion.div>
      </div>
    </section>
  );
}
