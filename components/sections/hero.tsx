"use client";

import { motion } from "framer-motion";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ShinyButton } from "@/components/ui/shiny-button";
import { ShimmerText } from "@/components/ui/shimmer-text";
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
            <span className="block whitespace-nowrap">Mehr Patienten.</span>
            <span className="block whitespace-nowrap">Mehr Umsatz.</span>
            <ShimmerText className="block whitespace-nowrap">Mehr Sicherheit.</ShimmerText>
          </h1>

          <p className="mt-6 mx-auto max-w-[34ch] text-balance text-xl leading-snug text-fg-primary md:mt-10 md:max-w-[52ch] md:text-2xl lg:text-3xl">
            Medienproduktion, bezahlte Anzeigen und KI-gestütztes Anfrage-System für Kliniken.
          </p>

          <div id="hero-cta" className="mt-6 flex flex-wrap items-start justify-center gap-4 md:mt-10">
            <div className="flex flex-col items-center gap-1">
              <ShinyButton href={CALENDLY_URL} target="_blank" rel="noopener noreferrer">
                Strategie-Gespräch buchen <ArrowUpRight className="h-5 w-5" />
              </ShinyButton>
              <span className="inline-flex items-center gap-2 font-mono text-sm text-fg-primary">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
                </span>
                Verfügbar · 30 Minuten
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
