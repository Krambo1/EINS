import "server-only";
import { LineChart } from "lucide-react";
import { getLatestSnapshot, loadForecastInputs } from "@/server/queries/forecast";
import { runForecast, MIN_SAMPLE_WON } from "@/server/forecast/engine";
import { formatMoney, type CurrencyCode } from "@/lib/formatting";

/**
 * Dashboard Forecast strip: three numbers (Pipeline-Wert, 30d, 90d). Hidden
 * entirely when the cold-start gate is active. The dashboard already has enough
 * density without a placeholder that won't render numbers.
 *
 * Reads the nightly snapshot; falls back to a live recompute if the
 * snapshot is older than 25 hours.
 */

const SNAPSHOT_FRESHNESS_MS = 25 * 60 * 60 * 1000;

interface StripData {
  pipelineValueEur: number;
  expectedBooked30dEur: number;
  expectedPaid30dEur: number;
  expectedBooked90dEur: number;
  expectedPaid90dEur: number;
  sampleSizeWon: number;
}

export async function ForecastStrip({
  clinicId,
  userId,
  currency,
}: {
  clinicId: string;
  userId: string;
  currency: CurrencyCode;
}) {
  const data = await loadStripData(clinicId, userId);
  // Cold-start: hide. Show the strip only once the forecast has enough signal.
  if (!data || data.sampleSizeWon < MIN_SAMPLE_WON) return null;

  return (
    <div
      className="block rounded-2xl border border-border p-5"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
      aria-label="Cashflow-Forecast"
    >
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-accent/10 p-2 text-accent">
          <LineChart className="h-4 w-4" />
        </div>
        <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
          Cashflow-Forecast (90 Tage)
        </div>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-3">
        <StripNumber
          label="Pipeline-Wert"
          value={formatMoney(data.pipelineValueEur, currency)}
          hint="aus offenen Anfragen"
        />
        <StripNumber
          label="Erwartet 30 Tage"
          value={formatMoney(data.expectedBooked30dEur, currency)}
          hint={`gezahlt ≈ ${formatMoney(data.expectedPaid30dEur, currency)}`}
        />
        <StripNumber
          label="Erwartet 90 Tage"
          value={formatMoney(data.expectedBooked90dEur, currency)}
          hint={`gezahlt ≈ ${formatMoney(data.expectedPaid90dEur, currency)}`}
        />
      </div>
    </div>
  );
}

function StripNumber({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div>
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="mt-1 font-display text-xl font-semibold tabular-nums text-fg-primary">
        {value}
      </div>
      <div className="mt-0.5 text-xs text-fg-tertiary">{hint}</div>
    </div>
  );
}

async function loadStripData(
  clinicId: string,
  userId: string
): Promise<StripData | null> {
  const snapshot = await getLatestSnapshot(clinicId, userId);
  const isFresh =
    snapshot != null &&
    Date.now() - new Date(snapshot.createdAt).getTime() < SNAPSHOT_FRESHNESS_MS;

  if (snapshot && isFresh) {
    const kpis = snapshot.topKpis as {
      pipelineValueEur: number;
      expectedBooked30dEur: number;
      expectedPaid30dEur: number;
      expectedBooked90dEur: number;
      expectedPaid90dEur: number;
    };
    return {
      pipelineValueEur: kpis.pipelineValueEur ?? 0,
      expectedBooked30dEur: kpis.expectedBooked30dEur ?? 0,
      expectedPaid30dEur: kpis.expectedPaid30dEur ?? 0,
      expectedBooked90dEur: kpis.expectedBooked90dEur ?? 0,
      expectedPaid90dEur: kpis.expectedPaid90dEur ?? 0,
      sampleSizeWon: snapshot.sampleSizeWon,
    };
  }

  // Stale or missing: recompute live. Acceptable cost (~50ms typical).
  const inputs = await loadForecastInputs(clinicId);
  if (inputs.totalWon < MIN_SAMPLE_WON) {
    return { ...zero(), sampleSizeWon: inputs.totalWon };
  }
  const result = runForecast(inputs);
  return {
    pipelineValueEur: result.topKpis.pipelineValueEur,
    expectedBooked30dEur: result.topKpis.expectedBooked30dEur,
    expectedPaid30dEur: result.topKpis.expectedPaid30dEur,
    expectedBooked90dEur: result.topKpis.expectedBooked90dEur,
    expectedPaid90dEur: result.topKpis.expectedPaid90dEur,
    sampleSizeWon: inputs.totalWon,
  };
}

function zero(): Omit<StripData, "sampleSizeWon"> {
  return {
    pipelineValueEur: 0,
    expectedBooked30dEur: 0,
    expectedPaid30dEur: 0,
    expectedBooked90dEur: 0,
    expectedPaid90dEur: 0,
  };
}
