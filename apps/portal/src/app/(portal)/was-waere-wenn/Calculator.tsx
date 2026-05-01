"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@eins/ui";
import { ArrowRight } from "lucide-react";

interface Baseline {
  leads: number;
  appointments: number;
  consultations: number;
  casesWon: number;
  spendEur: number;
  revenueEur: number;
  avgCaseEur: number;
}

const euro = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

const int = new Intl.NumberFormat("de-DE");

export function WhatIfCalculator({ baseline }: { baseline: Baseline }) {
  // Derived baseline rates.
  const baseAppointmentRate = baseline.leads > 0
    ? baseline.appointments / baseline.leads
    : 0.7;
  const baseShowRate = baseline.appointments > 0
    ? baseline.consultations / baseline.appointments
    : 0.8;
  const baseCloseRate = baseline.consultations > 0
    ? baseline.casesWon / baseline.consultations
    : 0.3;
  const baseCpl = baseline.leads > 0 ? baseline.spendEur / baseline.leads : 100;

  // Sliders
  const [budget, setBudget] = useState(baseline.spendEur);
  const [appointmentRate, setAppointmentRate] = useState(baseAppointmentRate);
  const [closeRate, setCloseRate] = useState(baseCloseRate);
  const [avgCase, setAvgCase] = useState(baseline.avgCaseEur);

  const projection = useMemo(() => {
    const leads = Math.round(baseCpl > 0 ? budget / baseCpl : 0);
    const appointments = Math.round(leads * appointmentRate);
    const consultations = Math.round(appointments * baseShowRate);
    const casesWon = Math.round(consultations * closeRate);
    const revenue = casesWon * avgCase;
    const roas = budget > 0 ? revenue / budget : 0;
    const profit = revenue - budget;
    return {
      leads,
      appointments,
      consultations,
      casesWon,
      revenue,
      roas,
      profit,
    };
  }, [budget, appointmentRate, closeRate, avgCase, baseCpl, baseShowRate]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Stellschrauben</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <Slider
            label="Werbebudget pro Monat"
            value={budget}
            min={Math.max(500, Math.round(baseline.spendEur * 0.2))}
            max={Math.max(20000, baseline.spendEur * 3)}
            step={250}
            formatValue={(v) => euro.format(v)}
            onChange={setBudget}
            explanation={
              baseline.spendEur > 0
                ? `Ist-Wert: ${euro.format(baseline.spendEur)}`
                : "Einfach ausprobieren"
            }
          />
          <Slider
            label="Anfrage → Termin"
            value={appointmentRate}
            min={0.2}
            max={0.95}
            step={0.01}
            formatValue={(v) => `${Math.round(v * 100)} %`}
            onChange={setAppointmentRate}
            explanation={`Ist-Wert: ${Math.round(baseAppointmentRate * 100)} %. Verbesserung durch schnellere Reaktion und konsequente Nachfasskette.`}
          />
          <Slider
            label="Beratung → Behandlung"
            value={closeRate}
            min={0.1}
            max={0.7}
            step={0.01}
            formatValue={(v) => `${Math.round(v * 100)} %`}
            onChange={setCloseRate}
            explanation={`Ist-Wert: ${Math.round(baseCloseRate * 100)} %. Verbesserung durch besseren Vertriebsleitfaden und Beratung.`}
          />
          <Slider
            label="Ø Umsatz pro Behandlung"
            value={avgCase}
            min={500}
            max={20000}
            step={250}
            formatValue={(v) => euro.format(v)}
            onChange={setAvgCase}
            explanation={`Ist-Wert: ${euro.format(baseline.avgCaseEur)}`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Projektion bei diesen Einstellungen</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <ProjectionStep label="Anfragen" value={int.format(projection.leads)} />
            <ArrowRight className="h-5 w-5 text-fg-secondary" />
            <ProjectionStep
              label="Termine"
              value={int.format(projection.appointments)}
            />
            <ArrowRight className="h-5 w-5 text-fg-secondary" />
            <ProjectionStep
              label="Beratungen"
              value={int.format(projection.consultations)}
            />
            <ArrowRight className="h-5 w-5 text-fg-secondary" />
            <ProjectionStep
              label="Behandlungen"
              value={int.format(projection.casesWon)}
              tone="accent"
            />
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <BigStat
              label="Umsatz"
              value={euro.format(projection.revenue)}
              tone="neutral"
            />
            <BigStat
              label="Gewinn nach Werbung"
              value={euro.format(projection.profit)}
              tone={projection.profit >= 0 ? "good" : "bad"}
            />
            <BigStat
              label="Werbeertrag"
              value={`${projection.roas.toFixed(2)} ×`}
              tone={
                projection.roas >= 3
                  ? "good"
                  : projection.roas >= 1.5
                  ? "warn"
                  : "bad"
              }
            />
          </div>

          <p className="mt-4 text-sm text-fg-secondary">
            „Werbeertrag“ bedeutet: für jeden investierten Euro kommen{" "}
            {euro.format(projection.roas)} zurück.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
  explanation,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue: (v: number) => string;
  onChange: (v: number) => void;
  explanation?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <label className="font-medium text-fg-primary">{label}</label>
        <span className="font-display text-xl font-semibold tabular-nums">
          {formatValue(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-accent"
      />
      {explanation && (
        <p className="mt-1 text-xs text-fg-secondary">{explanation}</p>
      )}
    </div>
  );
}

function ProjectionStep({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "accent";
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        tone === "accent"
          ? "border-accent bg-accent/10"
          : "border-border bg-bg-secondary/40"
      }`}
    >
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-0.5 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const toneMap = {
    good: "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)]",
    warn: "border-[var(--tone-warn-border)] bg-[var(--tone-warn-bg)]",
    bad: "border-[var(--tone-bad-border)] bg-[var(--tone-bad-bg)]",
    neutral: "border-border bg-bg-secondary/40",
  };
  return (
    <div className={`rounded-xl border p-4 ${toneMap[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 font-display text-3xl font-semibold tabular-nums">
        {value}
      </div>
    </div>
  );
}
