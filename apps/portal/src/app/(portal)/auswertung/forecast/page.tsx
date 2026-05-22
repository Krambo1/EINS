import { Suspense } from "react";
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from "@eins/ui";
import { LineChart } from "lucide-react";
import { requirePermissionOrRedirect } from "@/auth/guards";
import {
  getLatestSnapshot,
  getCalibrationHistory,
  loadForecastInputs,
} from "@/server/queries/forecast";
import { runForecast, MIN_SAMPLE_WON } from "@/server/forecast/engine";
import { formatEuro, formatNumber, formatRelative } from "@/lib/formatting";
import { ForecastChart, type WeeklyBucketDto } from "./_components/ForecastChart";
import {
  CalibrationChart,
  type CalibrationRowDto,
} from "./_components/CalibrationChart";
import { ForecastGate } from "./_components/ForecastGate";
import { AuswertungTabs } from "../_components/AuswertungTabs";

export const metadata = { title: "Forecast: Auswertung" };

// Stale-snapshot threshold. If the nightly worker hasn't run in 25 hours
// the page falls back to a live recompute so the inhaber never sees stale
// numbers (e.g. after a long outage). 25h instead of 24 leaves slack for
// the cron drift inside a single execution window.
const SNAPSHOT_FRESHNESS_MS = 25 * 60 * 60 * 1000;

interface ForecastView {
  buckets: WeeklyBucketDto[];
  topKpis: {
    pipelineValueEur: number;
    expectedBooked30dEur: number;
    expectedBooked60dEur: number;
    expectedBooked90dEur: number;
    expectedPaid30dEur: number;
    expectedPaid60dEur: number;
    expectedPaid90dEur: number;
  };
  sampleSizeWon: number;
  openRequestCount: number;
  excludedRequestCount: number;
  /** Source of the data shown: snapshot age, or "live". */
  freshness: { kind: "snapshot"; createdAt: Date } | { kind: "live" };
}

export default async function AuswertungForecastPage() {
  const session = await requirePermissionOrRedirect("reports.view");
  const view = await loadView(session.clinicId, session.userId);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold md:text-4xl">Auswertung.</h1>
        <p className="mt-2 text-base text-fg-primary md:text-lg">
          Ihre Werbung in Zahlen. Ehrlich, einfach und ohne Fachjargon.
        </p>
      </header>

      <AuswertungTabs active="forecast" />

      {view.sampleSizeWon < MIN_SAMPLE_WON ? (
        <ForecastGate currentWon={view.sampleSizeWon} />
      ) : (
        <>
          <KpiStrip topKpis={view.topKpis} freshness={view.freshness} />
          <Card className="print:break-inside-avoid">
            <CardHeader>
              <CardTitle>13-Wochen-Cashflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-fg-secondary">
                Erwarteter Cashflow je Kalenderwoche, getrennt nach gebuchtem und
                gezahltem Umsatz. Die schattierten Bänder zeigen die p10-p90-Bandbreite
                aus 500 Bootstrap-Stichproben Ihrer eigenen Abschluss-Historie.
              </p>
              <ForecastChart buckets={view.buckets} />
              {view.excludedRequestCount > 0 && (
                <div className="rounded-lg border border-border bg-bg-secondary/40 p-3 text-xs text-fg-secondary">
                  {formatNumber(view.excludedRequestCount)} offene{" "}
                  {view.excludedRequestCount === 1 ? "Anfrage" : "Anfragen"} nicht
                  prognostiziert (Behandlung ohne Abschluss-Historie). Sobald die
                  erste Behandlung dieser Art gewonnen wurde, fließt sie in den
                  nächsten Snapshot ein.
                </div>
              )}
            </CardContent>
          </Card>

          <Suspense fallback={<CalibrationSkeleton />}>
            <CalibrationSection
              clinicId={session.clinicId}
              userId={session.userId}
            />
          </Suspense>
        </>
      )}
    </div>
  );
}

async function loadView(clinicId: string, userId: string): Promise<ForecastView> {
  const snapshot = await getLatestSnapshot(clinicId, userId);
  const isFresh =
    snapshot != null &&
    Date.now() - new Date(snapshot.createdAt).getTime() < SNAPSHOT_FRESHNESS_MS;

  if (snapshot && isFresh) {
    return {
      buckets: (snapshot.weeklyBuckets as WeeklyBucketDto[]) ?? [],
      topKpis: snapshot.topKpis as ForecastView["topKpis"],
      sampleSizeWon: snapshot.sampleSizeWon,
      openRequestCount: snapshot.openRequestCount,
      excludedRequestCount: snapshot.excludedRequestCount,
      freshness: { kind: "snapshot", createdAt: snapshot.createdAt },
    };
  }

  // Stale or missing: recompute live. Acceptable cost: ~50ms for a typical
  // praxis. We do NOT persist the live recompute (worker owns writes).
  const inputs = await loadForecastInputs(clinicId);
  if (inputs.totalWon < MIN_SAMPLE_WON) {
    return {
      buckets: [],
      topKpis: zeroKpis(),
      sampleSizeWon: inputs.totalWon,
      openRequestCount: 0,
      excludedRequestCount: 0,
      freshness: { kind: "live" },
    };
  }
  const result = runForecast(inputs);
  return {
    buckets: result.weeklyBuckets,
    topKpis: result.topKpis,
    sampleSizeWon: inputs.totalWon,
    openRequestCount: result.forecastedRequestCount,
    excludedRequestCount: result.excludedRequestCount,
    freshness: { kind: "live" },
  };
}

function zeroKpis(): ForecastView["topKpis"] {
  return {
    pipelineValueEur: 0,
    expectedBooked30dEur: 0,
    expectedBooked60dEur: 0,
    expectedBooked90dEur: 0,
    expectedPaid30dEur: 0,
    expectedPaid60dEur: 0,
    expectedPaid90dEur: 0,
  };
}

function KpiStrip({
  topKpis,
  freshness,
}: {
  topKpis: ForecastView["topKpis"];
  freshness: ForecastView["freshness"];
}) {
  return (
    <section
      aria-label="Cashflow-Kennzahlen"
      className="space-y-3 print:break-inside-avoid"
    >
      <div className="grid gap-4 md:grid-cols-4">
        <KpiTile
          label="Pipeline-Wert heute"
          value={formatEuro(topKpis.pipelineValueEur)}
          hint="Σ (Wahrscheinlichkeit × Behandlungswert) offener Anfragen"
        />
        <KpiTile
          label="Erwartet 30 Tage"
          value={formatEuro(topKpis.expectedBooked30dEur)}
          hint={`gezahlt ≈ ${formatEuro(topKpis.expectedPaid30dEur)}`}
        />
        <KpiTile
          label="Erwartet 60 Tage"
          value={formatEuro(topKpis.expectedBooked60dEur)}
          hint={`gezahlt ≈ ${formatEuro(topKpis.expectedPaid60dEur)}`}
        />
        <KpiTile
          label="Erwartet 90 Tage"
          value={formatEuro(topKpis.expectedBooked90dEur)}
          hint={`gezahlt ≈ ${formatEuro(topKpis.expectedPaid90dEur)}`}
        />
      </div>
      <div className="text-xs text-fg-tertiary">
        {freshness.kind === "snapshot"
          ? `Letzter Snapshot: ${formatRelative(freshness.createdAt)} (nächtlich um 03:15 UTC aktualisiert)`
          : "Live berechnet (Snapshot fehlt oder ist älter als 24 Stunden)"}
      </div>
    </section>
  );
}

function KpiTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-bg-secondary/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
        {label}
      </div>
      <div className="mt-2 font-display text-2xl font-semibold tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-fg-tertiary">{hint}</div>}
    </div>
  );
}

async function CalibrationSection({
  clinicId,
  userId,
}: {
  clinicId: string;
  userId: string;
}) {
  const rows = (await getCalibrationHistory(clinicId, userId, 12)) as CalibrationRowDto[];
  const hasAnyData = rows.some((r) => r.predictedEur > 0 || r.actualEur > 0);

  return (
    <Card className="print:break-inside-avoid">
      <CardHeader>
        <CardTitle>Vorhersage vs. Realität (12 Wochen)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-fg-secondary">
          So gut hat der Forecast in den letzten 12 Wochen getroffen. Wenn die
          Linie die Säulen sauber begleitet, ist Ihre Pipeline planbar; wenn nicht,
          erhöhen wir die Bandbreite im nächsten Snapshot automatisch.
        </p>
        {hasAnyData ? (
          <CalibrationChart rows={rows} />
        ) : (
          <EmptyState
            icon={<LineChart className="h-8 w-8" />}
            title="Noch keine Verlaufs-Daten"
            description="Sobald 6 bis 12 Wochen mit Snapshots vorliegen, sehen Sie hier den Abgleich Vorhersage gegen Realität."
          />
        )}
      </CardContent>
    </Card>
  );
}

function CalibrationSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Vorhersage vs. Realität (12 Wochen)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[240px] animate-pulse rounded-md bg-bg-secondary/40" />
      </CardContent>
    </Card>
  );
}

