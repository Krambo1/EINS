import type { Treatment } from "@/lib/types";

/** Section 5 — Behandlung erklärt (sachlich). Required Pflichtangabe block included. */
export function TreatmentExplainer({ treatment }: { treatment: Treatment }) {
  const rows: { label: string; value: string }[] = [
    { label: "Indikation", value: treatment.explainer.indication },
    { label: "Ablauf", value: treatment.explainer.process },
    { label: "Erholung", value: treatment.explainer.recovery },
    { label: "Wirkdauer", value: treatment.explainer.duration },
    { label: "Mögliche Nebenwirkungen", value: treatment.explainer.sideEffects },
  ];

  return (
    <section id="behandlung" className="bg-brand-bg-soft">
      <div className="container mx-auto max-w-4xl py-14 md:py-20">
        <p className="eyebrow">Wie die Behandlung abläuft</p>
        <h2 className="mt-3">Was Sie zur Behandlung wissen sollten</h2>
        <div className="mt-8 divide-y divide-brand-border rounded-brand border border-brand-border bg-brand-bg">
          {rows.map((row) => (
            <div key={row.label} className="grid gap-1 p-5 md:grid-cols-[200px_1fr] md:gap-6">
              <div className="font-medium text-brand-fg">{row.label}</div>
              <p className="text-brand-fg-muted">{row.value}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 rounded-brand border-l-4 border-brand-primary bg-brand-bg p-4 text-sm leading-relaxed text-brand-fg">
          <strong className="block text-brand-fg">Pflichthinweis nach HWG:</strong>
          <span className="mt-1 block text-brand-fg-muted">{treatment.explainer.riskNotice}</span>
        </div>
      </div>
    </section>
  );
}
