"use client";

import { useState, useMemo, useRef, useLayoutEffect } from "react";
import { formatEuro } from "@/lib/utils";

const AVG_LTV = 4500;
const BASELINE_ADSPEND = 3000;

type ScenarioKey = "garantie" | "durchschnitt" | "top";

const SCENARIOS: Record<
  ScenarioKey,
  { label: string; baselineLeads: number; conversion: number }
> = {
  garantie:     { label: "Garantie",     baselineLeads: 90,  conversion: 0.15 },
  durchschnitt: { label: "Durchschnitt", baselineLeads: 130, conversion: 0.30 },
  top:          { label: "Top",          baselineLeads: 170, conversion: 0.50 },
};

const SCENARIO_ORDER: ScenarioKey[] = ["garantie", "durchschnitt", "top"];

export function RoiSlider() {
  const [adspend, setAdspend] = useState(3000);
  const [scenario, setScenario] = useState<ScenarioKey>("durchschnitt");

  const { leads, patients, revenue } = useMemo(() => {
    const cfg = SCENARIOS[scenario];
    const scale = adspend / BASELINE_ADSPEND;
    const ls = Math.round(cfg.baselineLeads * scale);
    const ps = Math.round(ls * cfg.conversion);
    const rv = ps * AVG_LTV;
    return { leads: ls, patients: ps, revenue: rv };
  }, [adspend, scenario]);

  const pct = ((adspend - 3000) / 17000) * 100;

  // Measure slider width so we can pixel-position the pulse overlay exactly on the thumb
  const sliderRef = useRef<HTMLInputElement>(null);
  const [thumbX, setThumbX] = useState(10);
  useLayoutEffect(() => {
    const el = sliderRef.current;
    if (!el) return;
    const THUMB = 20;
    const update = () => {
      const w = el.clientWidth;
      setThumbX(THUMB / 2 + (pct / 100) * (w - THUMB));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pct]);

  return (
    <div className="card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 md:p-10" style={{ contain: "layout style" }}>
      <div className="flex flex-col gap-8">
        {/* Card intro */}
        <div>
          <h3 className="font-display text-3xl font-semibold tracking-tight text-fg-primary md:text-4xl">
            Ihr Ertrag in 90 Tagen, live berechnet.
          </h3>
          <p className="mt-3 max-w-2xl text-base text-fg-secondary md:text-lg">
            Wählen Sie ein Szenario und stellen Sie Ihr monatliches Werbebudget ein. Die Zahlen unten aktualisieren sich in Echtzeit.
          </p>
        </div>

        {/* Scenario toggle */}
        <div className="flex flex-col gap-3">
          <label className="font-mono text-base font-medium text-fg-primary md:text-lg">
            1 · Szenario
          </label>
          <div
            role="tablist"
            aria-label="Szenario auswählen"
            className="inline-flex self-start gap-1 rounded-full border border-border bg-bg-primary/60 p-1"
          >
            {SCENARIO_ORDER.map((key) => {
              const active = scenario === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setScenario(key)}
                  className={`rounded-full px-5 py-2 font-mono text-sm font-medium transition-colors md:text-base ${
                    active
                      ? "bg-accent text-fg-primary"
                      : "text-fg-primary hover:bg-bg-primary"
                  }`}
                >
                  {SCENARIOS[key].label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Budget slider */}
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor="adspend" className="font-mono text-base font-medium text-fg-primary md:text-lg">
              2 · Monatliches Werbebudget
            </label>
            <span className="font-display text-2xl font-semibold text-accent md:text-3xl">
              {formatEuro(adspend)}
            </span>
          </div>
          <div className="relative">
            <input
              ref={sliderRef}
              id="adspend"
              type="range"
              min={3000}
              max={20000}
              step={500}
              value={adspend}
              onChange={(e) => setAdspend(Number(e.target.value))}
              className="eins-slider w-full"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
              }}
            />
            <div
              aria-hidden
              className="thumb-pulse-ring pointer-events-none absolute top-1/2 h-5 w-5 rounded-full"
              style={{
                left: `${thumbX}px`,
                transform: "translate(-50%, -50%)",
              }}
            />
          </div>
          <div className="flex justify-between font-mono text-sm text-fg-secondary">
            <span>3.000 € / Monat</span>
            <span>20.000 € / Monat</span>
          </div>
        </div>

        {/* Results */}
        <div className="border-t border-border pt-6">
          <div className="mb-5 font-mono text-base font-medium text-fg-primary md:text-lg">
            3 · Ihr Ergebnis nach 90 Tagen
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Metric label="Qualifizierte Anfragen" value={`${leads}`} />
            <Metric label="Neue Patienten" value={`${patients}`} />
            <Metric label="Umsatz" value={formatEuro(revenue)} highlight />
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="mb-2 font-mono text-base text-fg-primary md:text-lg">{label}</div>
      <div className={`font-display text-2xl font-semibold tracking-tighter tabular-nums whitespace-nowrap md:text-4xl ${highlight ? "text-accent-gradient" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
