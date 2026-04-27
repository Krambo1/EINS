"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Reveal } from "@/components/ui/reveal";
import { STATIONS } from "@/lib/timeline-data";
import { md } from "@/lib/md";
import { cn } from "@/lib/utils";

type Station = (typeof STATIONS)[number];

export function Timeline() {
  return (
    <section className="section relative">
      <div className="container">
        <Reveal delay={0.08}>
          <h2 className="display-l mx-auto max-w-6xl text-center">
            Von Tag&nbsp;1 bis zur ersten Anfrage.
          </h2>
        </Reveal>

        <div className="relative mt-10 md:mt-16">
          {/* Connector line */}
          <div
            aria-hidden
            className="absolute left-0 right-3 top-6 hidden h-px bg-gradient-to-r from-border via-accent/60 to-accent md:block"
          />
          {/* End arrow */}
          <ChevronRight
            aria-hidden
            className="absolute -right-1 top-6 hidden h-4 w-4 -translate-y-1/2 text-fg-primary md:block"
          />
          <div className="grid items-start gap-4 md:grid-cols-4 md:gap-6">
            {STATIONS.map((s, i) => (
              <Reveal key={s.title} delay={0.1 + i * 0.1}>
                <TimelineCard station={s} index={i} isLast={i === STATIONS.length - 1} />
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TimelineCard({
  station,
  index,
  isLast,
}: {
  station: Station;
  index: number;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div className="rounded-2xl border border-border bg-bg-secondary/60 p-5 backdrop-blur-sm md:rounded-none md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex w-full items-start justify-between gap-3 text-left md:pointer-events-none"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3 md:block">
              <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-full border border-accent/40 bg-bg-primary font-mono text-base font-semibold text-fg-primary">
                {index + 1}
              </span>
              <span className="font-mono text-base font-medium text-accent md:mt-4 md:block">
                {station.when}
              </span>
            </div>
            <h3 className="mt-3 font-display text-3xl font-semibold tracking-tight md:text-4xl">
              {station.title}
            </h3>
          </div>
          <ChevronDown
            aria-hidden
            className={cn(
              "mt-2 h-5 w-5 shrink-0 text-fg-secondary transition-transform duration-300 ease-expo group-hover:text-fg-primary md:hidden",
              open && "rotate-180"
            )}
          />
        </button>
        <div className="md:hidden">
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                key="content"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="overflow-hidden"
              >
                <ul className="mt-4 space-y-3 text-base leading-relaxed text-fg-primary">
                  {station.bullets.map((b) => (
                    <li key={b} className="flex gap-3">
                      <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                      <span>{md(b)}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <ul className="mt-4 hidden space-y-3 text-lg leading-relaxed text-fg-primary md:block">
          {station.bullets.map((b) => (
            <li key={b} className="flex gap-3">
              <span className="mt-[0.55em] h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span>{md(b)}</span>
            </li>
          ))}
        </ul>
      </div>
      {/* Vertical connector arrow between cards on mobile */}
      {!isLast && (
        <div className="mt-4 flex justify-center md:hidden" aria-hidden>
          <ChevronDown className="h-6 w-6 text-accent" strokeWidth={2} />
        </div>
      )}
    </div>
  );
}
