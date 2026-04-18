"use client";

import { useState, useMemo } from "react";
import { formatEuro } from "@/lib/utils";

const BASELINE_ADSPEND = 3000;
const BASELINE_LEADS = 43;
const AVG_CONVERSION = 0.3;
const AVG_LTV = 4500;

export function RoiSlider() {
  const [adspend, setAdspend] = useState(6000);

  const { leads, patients, revenue } = useMemo(() => {
    const ls = Math.round((adspend / BASELINE_ADSPEND) * BASELINE_LEADS);
    const ps = Math.round(ls * AVG_CONVERSION);
    const rv = ps * AVG_LTV;
    return { leads: ls, patients: ps, revenue: rv };
  }, [adspend]);

  return (
    <div className="card-glow rounded-2xl border border-border bg-bg-secondary/60 p-6 md:p-8">
      <div className="flex flex-col gap-6">
        <div>
          <div className="mb-2 flex items-baseline justify-between">
            <label htmlFor="adspend" className="font-mono text-base text-fg-secondary">
              Monatlicher Adspend
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
          />
          <div className="mt-1 flex justify-between font-mono text-xs text-fg-secondary">
            <span>3.000 EUR</span>
            <span>20.000 EUR</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
          <Metric label="Qualifizierte Leads / Monat" value={`~${leads}`} />
          <Metric label="Erwartete Patienten / Monat" value={`~${patients}`} />
          <Metric label="Erwarteter Umsatz / Monat" value={formatEuro(revenue)} highlight />
        </div>
      </div>

      <style jsx>{`
        .eins-slider {
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          background: linear-gradient(
            to right,
            var(--accent) 0%,
            var(--accent) ${((adspend - 3000) / 17000) * 100}%,
            var(--border) ${((adspend - 3000) / 17000) * 100}%,
            var(--border) 100%
          );
          border-radius: 999px;
          outline: none;
        }
        .eins-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent);
          cursor: pointer;
          box-shadow: 0 0 0 4px var(--accent-glow);
          transition: transform 200ms cubic-bezier(0.16, 1, 0.3, 1);
        }
        .eins-slider::-webkit-slider-thumb:hover {
          transform: scale(1.1);
        }
        .eins-slider::-moz-range-thumb {
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent);
          border: none;
          cursor: pointer;
          box-shadow: 0 0 0 4px var(--accent-glow);
        }
      `}</style>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="mb-1 font-mono text-base text-fg-secondary">{label}</div>
      <div className={`font-display text-2xl font-semibold tracking-tighter md:text-3xl ${highlight ? "text-accent-gradient" : "text-fg-primary"}`}>
        {value}
      </div>
    </div>
  );
}
