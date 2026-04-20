"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STATS, TAB_DEFS, type Stat } from "@/lib/stats-data";
import { Counter } from "@/components/ui/counter";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { md } from "@/lib/md";

export function TabExplorer() {
  const [tab, setTab] = useState<Stat["tab"]>("conversion");
  const stats = STATS.filter((s) => s.tab === tab);
  const [activeId, setActiveId] = useState<string>(stats[0].id);
  const active = stats.find((s) => s.id === activeId) ?? stats[0];

  const handleTabChange = (next: string) => {
    const nextTab = next as Stat["tab"];
    setTab(nextTab);
    const first = STATS.find((s) => s.tab === nextTab);
    if (first) setActiveId(first.id);
  };

  return (
    <div className="card-glow rounded-2xl border border-border bg-bg-secondary/60 px-3 py-6 backdrop-blur-sm md:rounded-3xl md:p-10">
      <Tabs value={tab} onValueChange={handleTabChange}>
        <div className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="tabs-fade-mask w-full max-w-full overflow-x-auto md:w-auto md:overflow-visible md:[mask-image:none]">
            <TabsList className="px-1 md:px-2">
              {TAB_DEFS.map((t) => (
                <TabsTrigger
                  key={t.id}
                  value={t.id}
                  className="shrink-0 px-3 text-sm md:px-4 md:text-base"
                >
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {stats.length > 1 && (
            <div className="flex items-center gap-3">
              <span className="hidden font-mono text-base tracking-wider text-fg-secondary sm:inline">
                Durchklicken
              </span>
              <svg
                className="hidden h-3 w-3 text-accent sm:block"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden
              >
                <path d="M2 6h8m0 0L7 3m3 3L7 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div
                role="tablist"
                aria-label="Statistik auswählen"
                className="flex flex-wrap gap-2"
              >
                {stats.map((s, i) => {
                  const isActive = s.id === active.id;
                  return (
                    <button
                      key={s.id}
                      role="tab"
                      aria-selected={isActive}
                      aria-controls="stat-panel"
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => setActiveId(s.id)}
                      aria-label={`Statistik ${i + 1} von ${stats.length} anzeigen`}
                      className={`font-mono text-base font-medium px-4 py-2 rounded-full border transition-all duration-200 cursor-pointer active:scale-95 ${
                        isActive
                          ? "border-accent bg-accent text-white shadow-[0_0_20px_-4px_rgba(88,186,181,0.5)] [text-shadow:0_1px_3px_rgba(0,0,0,0.25)]"
                          : "border-border-hover bg-bg-primary text-fg-primary hover:border-accent hover:bg-accent/10 hover:text-accent hover:scale-105"
                      }`}
                    >
                      0{i + 1}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Tabs>

      <AnimatePresence mode="wait">
        <motion.div
          key={active.id}
          id="stat-panel"
          role="tabpanel"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 md:mt-10"
        >
          <div className="font-display text-7xl font-semibold tracking-tightest md:text-8xl">
            <ShimmerText>
              <Counter
                to={active.bigNumber.value}
                prefix={active.bigNumber.prefix}
                suffix={active.bigNumber.suffix}
                decimals={active.bigNumber.decimals}
                duration={1400}
              />
            </ShimmerText>
          </div>
          <div className="mt-4 max-w-3xl text-balance font-display text-3xl font-medium leading-tight text-fg-primary md:text-4xl">{md(active.headline)}</div>
          <div className="mt-6 font-mono text-xs text-fg-secondary">
            Quelle: {active.source}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
