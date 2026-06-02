import Link from "next/link";
import type { ComponentType } from "react";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
  Button,
} from "@eins/ui";
import { requirePermissionOrRedirect } from "@/auth/guards";
import { hasUserPassedLeitfadenQuiz } from "@/server/queries/leitfaden";
import { PASS_THRESHOLD, TOTAL_QUESTIONS } from "./pruefung/questions";
import {
  PRINCIPLES,
  KPIS,
  PREP_STEPS,
  OPENING_SCRIPTS,
  DISCOVERY_INTRO,
  DISCOVERY_BLOCKS,
  OBJECTION_GROUPS,
  OBJECTIONS,
  HWG_TABLES,
  CLOSE_STEPS,
  NO_SHOW_INTRO,
  NO_SHOW_CADENCE,
  NO_SHOW_TEMPLATES,
  type PrincipleIcon,
} from "./content";
import {
  HeartHandshake,
  Scale,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Clock,
  Users,
  ArrowRight,
  FileText,
} from "lucide-react";

export const metadata = { title: "Vertriebsleitfaden" };

/**
 * Staff-facing playbook for clinic reception/sales handling inbound calls from
 * Meta/Google ad leads. HWG-konform, Sie-Form.
 *
 * This is the KURZFASSUNG: it renders only the `core` items from
 * `./content.ts`, reordered so the richest, most-referenced material leads
 * (Prinzipien → KPI → Eröffnung → Einwände → HWG → Close). The COMPLETE
 * playbook (all 23 Einwände, all 7 HWG-Tabellen, every No-Show-Vorlage, plus
 * the Vermeiden-Liste, Cheat-Sheet and Rechtsgrundlagen) is generated from the
 * SAME `content.ts` into a downloadable PDF under /dokumente, so the page and
 * the PDF can never drift. Edit copy in `content.ts`, not here.
 */

const PRINCIPLE_ICONS: Record<PrincipleIcon, ComponentType<{ className?: string }>> = {
  HeartHandshake,
  Scale,
  CheckCircle2,
  MessageCircle,
  ShieldCheck,
  Clock,
};

export default async function LeitfadenPage() {
  const session = await requirePermissionOrRedirect("leitfaden.view");
  const hasPassedQuiz = await hasUserPassedLeitfadenQuiz(
    session.clinicId,
    session.userId
  );

  const corePrinciples = PRINCIPLES.filter((p) => p.core);
  const coreKpis = KPIS.filter((k) => k.core);
  const coreOpenings = OPENING_SCRIPTS.filter((s) => s.core);
  const coreHwg = HWG_TABLES.filter((t) => t.core);
  const coreClose = CLOSE_STEPS.filter((s) => s.core);
  const corePrep = PREP_STEPS.filter((s) => s.core);
  const coreDiscovery = DISCOVERY_BLOCKS.filter((b) => b.core);
  const coreTemplates = NO_SHOW_TEMPLATES.filter((t) => t.core);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Vertriebsleitfaden.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          So verwandeln Sie eine Anfrage in einen Beratungstermin, ohne gegen HWG, MBO-Ä oder DSGVO zu verstoßen. Bewährte Abläufe für eingehende Anrufe aus Meta- und Google-Anzeigen.
        </p>
      </header>

      {/* Kurzfassung-Banner → vollständige PDF unter Dokumente */}
      <Link
        href="/dokumente?kind=vertriebsleitfaden"
        className="flex items-center gap-4 rounded-2xl border border-accent/30 bg-accent-soft p-4 transition hover:border-accent/60 md:p-5"
      >
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-fg-primary">
            Dies ist die Kurzfassung.
          </div>
          <p className="text-sm text-fg-primary">
            Die vollständige Version mit allen Einwänden, HWG-Tabellen und Vorlagen finden Sie als PDF unter Dokumente.
          </p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-accent" />
      </Link>

      {/* 1. Prinzipien */}
      <section id="prinzipien" className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">Sechs goldene Prinzipien</h3>
        <div className="space-y-3">
          {corePrinciples.map((p) => {
            const Icon = PRINCIPLE_ICONS[p.icon];
            return (
              <Rule key={p.id} icon={<Icon className="h-5 w-5" />} title={p.title}>
                {p.body}
              </Rule>
            );
          })}
        </div>
      </section>

      {/* 2. KPI-Ziele */}
      <section id="kpi" className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">KPI-Ziele für jeden Anruf</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          {coreKpis.map((k) => (
            <Kpi key={k.id} label={k.label} value={k.value} hint={k.hint} />
          ))}
        </div>
      </section>

      {/* 3. Gesprächs-Eröffnung */}
      <section id="eroeffnung" className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">Gesprächs-Eröffnung, wortwörtlich</h3>
        <Accordion type="multiple" className="space-y-2">
          {coreOpenings.map((s) => (
            <Step
              key={s.id}
              value={s.id}
              title={s.title}
              content={
                <>
                  {s.patientLine && (
                    <p className="text-sm font-medium">{s.patientLine}</p>
                  )}
                  <Quote>{`„${s.quote}“`}</Quote>
                  <p className="text-sm text-fg-secondary">{s.note}</p>
                </>
              }
            />
          ))}
        </Accordion>
      </section>

      {/* 4. Einwandbehandlung (häufigste Einwände) */}
      <section id="einwand" className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">Einwandbehandlung: die häufigsten Einwände</h3>
        <div className="space-y-6">
          <p className="text-sm text-fg-secondary">
            Pro Eintrag: eigentliche Sorge, HWG-konforme Antwort wortwörtlich, was zu vermeiden ist. Sie können die Antworten direkt vorlesen. Alle 23 Einwände stehen in der PDF unter Dokumente.
          </p>
          {OBJECTION_GROUPS.map((g) => {
            const items = OBJECTIONS.filter((o) => o.group === g.id && o.core);
            if (items.length === 0) return null;
            return (
              <ObjectionGroup key={g.id} label={g.label}>
                <Accordion type="multiple" className="space-y-2">
                  {items.map((o) => (
                    <Objection
                      key={o.id}
                      value={o.id}
                      title={o.title}
                      concern={o.concern}
                      answer={o.answer}
                      avoid={o.avoid}
                    />
                  ))}
                </Accordion>
              </ObjectionGroup>
            );
          })}
        </div>
      </section>

      {/* 5. HWG-Quick-Reference */}
      <section className="scroll-mt-24">
        <h3 id="hwg" className="opa-h3 mb-4 scroll-mt-24 text-fg-primary">
          HWG-Quick-Reference: Sag-So, Sag-So-Nicht
        </h3>
        <p className="mb-4 text-sm text-fg-secondary">
          Die drei wichtigsten Tabellen mit konkreten Formulierungen. Jede Sag-So-Nicht-Zeile ist ein konkretes HWG-, MBO-Ä- oder UWG-Risiko. Alle sieben Tabellen stehen in der PDF.
        </p>
        <Accordion type="multiple" className="space-y-2">
          {coreHwg.map((t) => (
            <SagSoBlock key={t.id} value={t.id} title={t.title} rows={t.rows} />
          ))}
        </Accordion>
      </section>

      {/* 6. Termin-Close + DSGVO */}
      <section className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">
          Termin-Close und DSGVO-Datenaufnahme
        </h3>
        <Accordion type="multiple" className="space-y-2">
          {coreClose.map((s) => (
            <Step
              key={s.id}
              value={s.id}
              title={s.title}
              content={
                <>
                  {s.quote && <Quote>{`„${s.quote}“`}</Quote>}
                  {s.list && (
                    <ol className="ml-5 list-decimal space-y-1">
                      {s.list.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ol>
                  )}
                  {s.note && (
                    <p className="text-sm text-fg-secondary">{s.note}</p>
                  )}
                </>
              }
            />
          ))}
        </Accordion>
      </section>

      {/* 7. Vor jedem Anruf */}
      <section id="vorbereitung" className="scroll-mt-24">
        <h3 className="opa-h3 mb-4 text-fg-primary">Vor jedem Anruf in 30 Sekunden</h3>
        <ol className="ml-5 list-decimal space-y-2 text-base text-fg-primary">
          {corePrep.map((s) => (
            <li key={s.id}>{s.text}</li>
          ))}
        </ol>
      </section>

      {/* 8. Discovery (Block A + rote Flaggen) */}
      <section className="scroll-mt-24">
        <h3 id="discovery" className="opa-h3 mb-4 scroll-mt-24 text-fg-primary">
          Discovery: die wichtigsten Fragen
        </h3>
        <p className="mb-4 text-sm text-fg-secondary">{DISCOVERY_INTRO}</p>
        <Accordion type="multiple" className="space-y-2">
          {coreDiscovery.map((b) => (
            <Step
              key={b.id}
              value={b.id}
              title={b.title}
              content={
                <>
                  {b.list === "ol" ? (
                    <ol className="ml-5 list-decimal space-y-1" start={b.start}>
                      {b.items.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="ml-5 list-disc space-y-1">
                      {b.items.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  )}
                  {b.note && (
                    <p className="mt-3 text-sm text-fg-secondary">{b.note}</p>
                  )}
                </>
              }
            />
          ))}
        </Accordion>
      </section>

      {/* 9. No-Show-Prävention */}
      <section className="scroll-mt-24">
        <h3 id="no-show" className="opa-h3 mb-4 scroll-mt-24 text-fg-primary">
          No-Show-Prävention: Cadence und Vorlagen
        </h3>
        <div className="space-y-4">
          <p className="text-sm text-fg-secondary">{NO_SHOW_INTRO}</p>
          <CadenceTable />
          <Accordion type="multiple" className="space-y-2">
            {coreTemplates.map((t) => (
              <Template key={t.id} value={t.id} title={t.title} text={t.text} />
            ))}
          </Accordion>
          <p className="text-sm text-fg-secondary">
            Alle 13 Vorlagen (Bestätigung, Erinnerungen, No-Show-Nachfass, Reaktivierung, Storno) finden Sie in der PDF unter Dokumente.
          </p>
        </div>
      </section>

      {/* 10. Prüfung-CTA */}
      <section className="print:hidden">
        <div
          className={`rounded-2xl border p-6 ${
            hasPassedQuiz
              ? "border-[var(--tone-good-border)] bg-[var(--tone-good-bg)]"
              : "border-accent/30 bg-accent-soft"
          }`}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <h3 className="flex items-center gap-2 text-xl font-semibold text-fg-primary">
                <ShieldCheck className="h-5 w-5" />
                {hasPassedQuiz
                  ? "Sie haben die Leitfaden-Prüfung bestanden."
                  : "Leitfaden-Prüfung — Mitwirkungspflicht laut EINS-Garantie"}
              </h3>
              <p className="text-sm text-fg-primary">
                {hasPassedQuiz
                  ? "Wenn Sie möchten, können Sie die Prüfung jederzeit erneut versuchen."
                  : `${TOTAL_QUESTIONS} Fragen aus diesem Leitfaden, ${PASS_THRESHOLD} richtig zum Bestehen, Versuche unbegrenzt. Mindestens ein:e Mitarbeiter:in pro Praxis muss bestehen, damit die Garantie greift.`}
              </p>
            </div>
            <Button asChild variant={hasPassedQuiz ? "outline" : "default"}>
              <Link href="/leitfaden/pruefung">
                {hasPassedQuiz ? "Erneut versuchen" : "Prüfung starten"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Rule({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-4 rounded-xl border border-border bg-bg-secondary p-4">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent/15 text-accent">
        {icon}
      </div>
      <div>
        <div className="font-semibold text-fg-primary">{title}</div>
        <p className="mt-1 text-base text-fg-primary">{children}</p>
      </div>
    </div>
  );
}

function Step({
  value,
  title,
  content,
}: {
  value: string;
  title: string;
  content: React.ReactNode;
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="space-y-2 pb-4 text-base text-fg-primary">
        {content}
      </AccordionContent>
    </AccordionItem>
  );
}

function Quote({ children }: { children: React.ReactNode }) {
  return (
    <blockquote className="rounded-xl border-l-4 border-accent bg-bg-secondary px-4 py-3 italic text-fg-primary">
      {children}
    </blockquote>
  );
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary p-4">
      <div className="text-xs uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-fg-primary">{value}</div>
      {hint && <div className="mt-1 text-xs text-fg-secondary">{hint}</div>}
    </div>
  );
}

function ObjectionGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Users className="h-4 w-4 text-accent" />
        <h3 className="text-base font-semibold text-fg-primary">{label}</h3>
      </div>
      {children}
    </div>
  );
}

function Objection({
  value,
  title,
  concern,
  answer,
  avoid,
}: {
  value: string;
  title: string;
  concern: string;
  answer: string;
  avoid: string[];
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-4 text-base text-fg-primary">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            Eigentliche Sorge
          </div>
          <p className="mt-1 text-sm text-fg-primary">{concern}</p>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            HWG-konforme Antwort, Sie-Form
          </div>
          <Quote>{`„${answer}“`}</Quote>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            Was vermeiden
          </div>
          <ul className="mt-1 ml-5 list-disc space-y-1 text-sm">
            {avoid.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function SagSoBlock({
  value,
  title,
  rows,
}: {
  value: string;
  title: string;
  rows: [string, string][];
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="w-1/2 py-2 pr-3 text-left text-xs font-semibold uppercase tracking-wide text-tone-bad">
                  Sag-So-Nicht
                </th>
                <th className="w-1/2 py-2 pl-3 text-left text-xs font-semibold uppercase tracking-wide text-accent">
                  Sag-So
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([bad, good], i) => (
                <tr key={i} className="border-b border-border/60 last:border-0">
                  <td className="py-3 pr-3 align-top text-fg-primary">{bad}</td>
                  <td className="py-3 pl-3 align-top text-fg-primary">{good}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

function CadenceTable() {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary">
          <tr className="border-b border-border">
            <th className="w-1/4 py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Zeitpunkt
            </th>
            <th className="w-1/4 py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Kanal
            </th>
            <th className="py-2 px-3 text-left text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              Zweck
            </th>
          </tr>
        </thead>
        <tbody>
          {NO_SHOW_CADENCE.map((r, i) => (
            <tr key={i} className="border-b border-border/60 last:border-0">
              <td className="py-3 px-3 align-top font-medium text-fg-primary">
                {r.time}
              </td>
              <td className="py-3 px-3 align-top text-fg-primary">{r.channel}</td>
              <td className="py-3 px-3 align-top text-fg-primary">{r.purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Template({
  value,
  title,
  text,
}: {
  value: string;
  title: string;
  text: string;
}) {
  return (
    <AccordionItem value={value} className="rounded-xl border border-border px-4">
      <AccordionTrigger className="text-base font-semibold">
        {title}
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-xl border border-border bg-bg-secondary p-4 font-mono text-xs leading-relaxed text-fg-primary">
{text}
        </pre>
      </AccordionContent>
    </AccordionItem>
  );
}
