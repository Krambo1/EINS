"use client";

import { useState, useMemo } from "react";
import { formatEuro } from "@/lib/utils";

const AVG_LTV = 2500;
const BASELINE_ADSPEND = 3000;
const SCALING_EXPONENT = 0.85;

type ScenarioKey = "konservativ" | "realistisch" | "top";

const SCENARIOS: Record<
  ScenarioKey,
  { label: string; description: string; baselineLeads: number; conversion: number }
> = {
  konservativ: {
    label: "Konservativ",
    description: "Untergrenze des Modells, mit Sicherheitspuffer kalkuliert.",
    baselineLeads: 50,
    conversion: 0.12,
  },
  realistisch: {
    label: "Realistisch",
    description: "Erwartbarer Korridor nach 90 Tagen sauberer Umsetzung.",
    baselineLeads: 65,
    conversion: 0.20,
  },
  top: {
    label: "Top-Performer",
    description: "Obergrenze des Modells, was eine sauber laufende Kampagne nach 90 Tagen liefern kann.",
    baselineLeads: 90,
    conversion: 0.30,
  },
};

const SCENARIO_ORDER: ScenarioKey[] = ["konservativ", "realistisch", "top"];

export function RoiSlider() {
  const [adspend, setAdspend] = useState(3000);
  const [scenario, setScenario] = useState<ScenarioKey>("realistisch");

  const { leads, patients, revenue, investment } = useMemo(() => {
    const cfg = SCENARIOS[scenario];
    const scale = Math.pow(adspend / BASELINE_ADSPEND, SCALING_EXPONENT);
    const ls = Math.round(cfg.baselineLeads * scale);
    const ps = Math.round(ls * cfg.conversion);
    const rv = ps * AVG_LTV;
    const inv = adspend * 3;
    return { leads: ls, patients: ps, revenue: rv, investment: inv };
  }, [adspend, scenario]);

  const pct = ((adspend - 3000) / 17000) * 100;
  const activeScenario = SCENARIOS[scenario];

  return (
    <div className="card-glow mx-auto max-w-3xl rounded-2xl border border-border bg-bg-secondary/60 p-6 md:p-10" style={{ contain: "layout style" }}>
      <div className="flex flex-col gap-8">
        {/* Card intro */}
        <p className="mx-auto hidden max-w-2xl text-center text-base text-fg-secondary md:block md:text-lg">
          In drei Schritten: Szenario wählen, monatliches Werbebudget einstellen. Sie sehen sofort, wie viele qualifizierte Anfragen, neue Patienten und welchen Umsatz Sie nach 90 Tagen erwarten dürfen.
        </p>

        {/* Scenario toggle */}
        <div className="flex flex-col items-center gap-3 text-center">
          <label className="font-mono text-base font-medium text-fg-primary md:text-lg">
            1 · Welches Szenario passt zu Ihnen?
          </label>
          <div
            role="tablist"
            aria-label="Szenario auswählen"
            className="inline-flex gap-1 rounded-full border border-border bg-bg-primary/60 p-1"
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
                  className={`rounded-full px-3 py-2 font-mono text-sm font-medium transition-colors md:px-5 md:text-base ${
                    active
                      ? "bg-accent text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.25)]"
                      : "text-fg-primary hover:bg-bg-primary"
                  }`}
                >
                  {SCENARIOS[key].label}
                </button>
              );
            })}
          </div>
          <p className="text-sm leading-relaxed text-fg-secondary md:text-base">
            {activeScenario.description}
          </p>
        </div>

        {/* Budget slider */}
        <div className="flex flex-col gap-3">
          <div className="flex flex-col items-center gap-1 text-center md:flex-row md:items-baseline md:justify-center md:gap-4">
            <label htmlFor="adspend" className="font-mono text-base font-medium text-fg-primary md:text-lg">
              2 · Ihr monatliches Werbebudget
            </label>
            <span className="font-display text-2xl font-semibold text-accent md:text-3xl">
              {formatEuro(adspend)}
            </span>
          </div>
          <div className="relative">
            <input
              id="adspend"
              type="range"
              min={3000}
              max={20000}
              step={500}
              value={adspend}
              onChange={(e) => setAdspend(Number(e.target.value))}
              aria-valuetext={`${formatEuro(adspend)} pro Monat`}
              className="eins-slider w-full"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
              }}
            />
            <div
              aria-hidden
              className="thumb-pulse-ring pointer-events-none absolute top-1/2 h-5 w-5 rounded-full"
              style={{
                left: `calc(10px + ${pct / 100} * (100% - 20px))`,
                transform: "translate(-50%, calc(-50% + 3px))",
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
          <div className="mb-5 text-center font-mono text-base font-medium text-fg-primary md:text-lg">
            3 · Ihr Ergebnis nach 90 Tagen
          </div>
          <div className="grid grid-cols-2 gap-4 text-center md:grid-cols-3">
            <Metric label="Qualifizierte Anfragen" value={`${leads}`} />
            <Metric label="Neue Patienten" value={`${patients}`} />
            <Metric label="Umsatz" value={formatEuro(revenue)} highlight className="col-span-2 md:col-span-1" />
          </div>

          {/* Investment vs. revenue comparison */}
          <div className="mt-6 hidden flex-col items-center gap-3 rounded-xl border border-accent/40 bg-accent/[0.06] p-5 text-center md:mt-8 md:flex md:flex-row md:items-center md:justify-center md:gap-10 md:p-6">
            <div className="flex items-center gap-4 md:gap-6">
              <div>
                <div className="font-mono text-xs uppercase tracking-wide text-fg-secondary md:text-sm">
                  Sie investieren (90 Tage)
                </div>
                <div className="mt-1 font-display text-xl font-semibold tabular-nums text-fg-primary md:text-3xl">
                  {formatEuro(investment)}
                </div>
              </div>
              <div className="font-display text-2xl text-fg-secondary md:text-3xl" aria-hidden>
                →
              </div>
              <div>
                <div className="font-mono text-xs uppercase tracking-wide text-fg-secondary md:text-sm">
                  Sie erwirtschaften
                </div>
                <div className="mt-1 font-display text-xl font-semibold tabular-nums text-accent md:text-3xl">
                  {formatEuro(revenue)}
                </div>
              </div>
            </div>
            <p className="text-sm leading-relaxed text-fg-secondary md:max-w-xs md:text-base">
              Werbebudget × 3 Monate gegen den realisierbaren Umsatz aus den neugewonnenen Patienten.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, highlight, className }: { label: string; value: string; highlight?: boolean; className?: string }) {
  return (
    <div className={className}>
      <div className="mb-2 font-mono text-base text-fg-primary md:text-lg">{label}</div>
      <div className={`font-display text-2xl font-semibold tracking-tighter tabular-nums whitespace-nowrap md:text-4xl ${highlight ? "text-accent-gradient" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
