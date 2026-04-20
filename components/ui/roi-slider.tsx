"use client";

import { useState, useMemo } from "react";
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

  return (
    <div className="card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 md:p-8" style={{ contain: "layout style" }}>
      <div className="flex flex-col gap-6">
        {/* Scenario toggle */}
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
                    ? "bg-accent text-bg-primary"
                    : "text-fg-primary hover:bg-bg-primary"
                }`}
              >
                {SCENARIOS[key].label}
              </button>
            );
          })}
        </div>

        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="adspend" className="font-mono text-base text-fg-secondary">
              Monatliches Werbebudget
            </label>
            <span className="font-mono text-xl text-accent">{formatEuro(adspend)}</span>
          </div>
          <input
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
          <div className="mt-1 flex justify-between font-mono text-xs text-fg-secondary">
            <span>3.000 €</span>
            <span>20.000 €</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
          <Metric label="Qualifizierte Anfragen / 90 Tage" value={`${leads}`} />
          <Metric label="Hochwertige Patienten / 90 Tage" value={`${patients}`} />
          <Metric label="Ertrag / 90 Tage" value={formatEuro(revenue)} highlight />
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="mb-1 font-mono text-base text-fg-secondary">{label}</div>
      <div className={`font-display text-xl font-semibold tracking-tighter tabular-nums whitespace-nowrap md:text-3xl ${highlight ? "text-accent-gradient" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
