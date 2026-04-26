import { Card, CardContent } from "@eins/ui";
import {
  formatDateTime,
  formatEuro,
  formatNumber,
  formatPercent,
} from "@/lib/formatting";
import {
  KPI_THRESHOLDS,
  toneForHigherBetter,
  toneForLowerBetter,
} from "@/server/constants/admin";
import type { ClinicPerformance } from "@/server/queries/admin";
import type { schema } from "@/db/client";
import { MetricTile } from "@eins/ui";

type Clinic = typeof schema.clinics.$inferSelect;

const GLOW_CARD = "card-glow !bg-bg-secondary/60 backdrop-blur-sm";

export function OverviewTab({
  clinic,
  totals,
  perf,
}: {
  clinic: Clinic;
  totals: { requests: number; documents: number; assets: number };
  perf: ClinicPerformance;
}) {
  const { summary } = perf;
  const cplTone = toneForLowerBetter(summary.cpl, KPI_THRESHOLDS.cpl);
  const cppTone = toneForLowerBetter(summary.cpp, KPI_THRESHOLDS.cpp);
  const roasTone = toneForHigherBetter(summary.roas, KPI_THRESHOLDS.roas);
  const noShowTone = toneForLowerBetter(summary.noShowRate, KPI_THRESHOLDS.noShow);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricTile
          label="Werbebudget"
          value={formatEuro(summary.spendEur)}
          sublabel="90 Tage"
        />
        <MetricTile
          label="Werbeumsatz"
          value={formatEuro(summary.revenueEur)}
          sublabel="90 Tage"
          tone="accent"
        />
        <MetricTile
          label="ROAS"
          value={summary.roas == null ? "–" : `${summary.roas.toFixed(2)}×`}
          sublabel={`Ziel ≥ ${KPI_THRESHOLDS.roas.good}×`}
          tone={roasTone}
        />
        <MetricTile
          label="CPL"
          value={summary.cpl == null ? "–" : formatEuro(summary.cpl)}
          sublabel={`Ziel ≤ ${KPI_THRESHOLDS.cpl.good} €`}
          tone={cplTone}
        />
        <MetricTile
          label="Cost per Patient"
          value={summary.cpp == null ? "–" : formatEuro(summary.cpp)}
          sublabel={`Ziel ≤ ${KPI_THRESHOLDS.cpp.good} €`}
          tone={cppTone}
        />
        <MetricTile
          label="No-Show"
          value={
            summary.noShowRate == null
              ? "–"
              : formatPercent(summary.noShowRate)
          }
          sublabel="Ø 90 Tage"
          tone={noShowTone}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricTile
          label="Anfragen gesamt"
          value={formatNumber(totals.requests)}
          sublabel="alle Zeit"
        />
        <MetricTile
          label="Dokumente"
          value={formatNumber(totals.documents)}
          sublabel="im Klinik-Ordner"
        />
        <MetricTile
          label="Medien"
          value={formatNumber(totals.assets)}
          sublabel="Fotos + Videos"
        />
      </div>

      <Card className={GLOW_CARD}>
        <CardContent className="space-y-4 pt-6">
          <h2 className="font-display text-xl font-semibold">Stammdaten</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Slug" value={clinic.slug} mono />
            <Field
              label="Plan-Beginn"
              value={formatDateTime(clinic.planStartedAt)}
            />
            <Field
              label="Standard-Behandler"
              value={clinic.defaultDoctorEmail ?? "–"}
              mono
            />
            <Field label="HWG-Kontakt" value={clinic.hwgContactName ?? "–"} />
            <Field
              label="HWG-E-Mail"
              value={clinic.hwgContactEmail ?? "–"}
              mono
            />
            <Field
              label="Erstellt"
              value={formatDateTime(clinic.createdAt)}
            />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-fg-secondary">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-fg-primary ${mono ? "font-mono text-xs" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}
