import type { Treatment } from "@/lib/types";

/** Section 5 — Behandlung erklärt (sachlich). Required HWG-Pflichtangabe block included. */
export function TreatmentExplainer({ treatment }: { treatment: Treatment }) {
  const rows: { label: string; value: string }[] = [
    { label: "Für wen geeignet", value: treatment.explainer.indication },
    { label: "So läuft es ab", value: treatment.explainer.process },
    { label: "Erholung", value: treatment.explainer.recovery },
    { label: "Wie lange es wirkt", value: treatment.explainer.duration },
    { label: "Mögliche Nebenwirkungen", value: treatment.explainer.sideEffects },
  ];

  return (
    <section id="behandlung" className="scroll-mt-24 bg-brand-bg-soft">
      <div className="container mx-auto max-w-4xl py-16 md:py-24">
        <p className="eyebrow">03 · Die Behandlung</p>
        <h2 className="mt-3">Was Sie zur Behandlung wissen sollten</h2>
        <div className="mt-8 divide-y divide-brand-border rounded-brand-lg border border-brand-border bg-brand-bg">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 p-5 md:grid-cols-[210px_1fr] md:gap-6 md:p-6">
              <div className="font-medium text-brand-fg">{row.label}</div>
              <p className="leading-relaxed text-brand-fg-muted">{row.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-brand border-l-4 border-brand-accent bg-brand-bg p-4 text-sm leading-relaxed">
          <strong className="block text-brand-fg">Pflichthinweis nach HWG:</strong>
          <span className="mt-1 block text-brand-fg-muted">{treatment.explainer.riskNotice}</span>
        </div>
      </div>
    </section>
  );
}
