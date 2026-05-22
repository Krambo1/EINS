import { LineChart } from "lucide-react";
import { Card, CardContent } from "@eins/ui";
import { MIN_SAMPLE_WON } from "@/server/forecast/engine";
import { formatNumber } from "@/lib/formatting";

/**
 * Cold-start gate: shown while a praxis has fewer than MIN_SAMPLE_WON
 * closed deals. Honesty trade-off (per the design decision): we don't
 * fake the forecast with platform averages: we show the runway and the
 * remaining deals needed.
 */
export function ForecastGate({ currentWon }: { currentWon: number }) {
  const remaining = Math.max(0, MIN_SAMPLE_WON - currentWon);
  const progressPct = Math.min(
    100,
    Math.round((currentWon / MIN_SAMPLE_WON) * 100)
  );

  return (
    <Card>
      <CardContent className="space-y-6 p-8 md:p-10">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-accent/10 p-3 text-accent">
            <LineChart className="h-6 w-6" />
          </div>
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-fg-secondary">
              Cashflow-Forecast
            </div>
            <h2 className="opa-h3 text-fg-primary">
              Wird ab {MIN_SAMPLE_WON} abgeschlossenen Behandlungen freigeschaltet
            </h2>
          </div>
        </div>

        <p className="max-w-prose text-sm text-fg-secondary md:text-base">
          Eine ehrliche Vorhersage braucht eine belastbare Stichprobe Ihrer eigenen
          Praxis. Wir starten den Forecast erst, wenn wir die Abschluss-Quoten und
          die Zeiten von Anfrage bis Behandlung aus Ihrer realen Historie ableiten
          können. Plattform-Durchschnitte tun das nicht für Sie: sie verschieben das
          Risiko vom Algorithmus zu Ihrer Bauchentscheidung.
        </p>

        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <div className="text-sm font-medium text-fg-primary tabular-nums">
              {formatNumber(currentWon)} von {MIN_SAMPLE_WON}
            </div>
            <div className="text-xs text-fg-tertiary">
              {remaining > 0
                ? `Noch ${formatNumber(remaining)} Abschlüsse`
                : "Bereit für nächsten Snapshot"}
            </div>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progressPct}%` }}
              role="progressbar"
              aria-valuenow={currentWon}
              aria-valuemin={0}
              aria-valuemax={MIN_SAMPLE_WON}
              aria-label="Fortschritt zur Forecast-Freischaltung"
            />
          </div>
        </div>

        <div className="rounded-lg border border-border bg-bg-secondary/40 p-4 text-xs text-fg-secondary md:text-sm">
          <strong className="text-fg-primary">Warum diese Schwelle?</strong> Mit
          weniger als {MIN_SAMPLE_WON} Abschlüssen wären die Bandbreiten so weit,
          dass die Zahl auf dem Bildschirm keine Entscheidung mehr trägt: nicht für
          das Bankgespräch, nicht für die Geräte-Investition, nicht für die
          Personal-Planung. Sobald wir genug Daten haben, läuft der Snapshot
          jede Nacht automatisch.
        </div>
      </CardContent>
    </Card>
  );
}
