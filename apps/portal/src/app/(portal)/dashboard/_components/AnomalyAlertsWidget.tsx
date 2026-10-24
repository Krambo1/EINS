import "server-only";
import { AlertTriangle, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, ExplainerPopover } from "@eins/ui";
import { getActiveAlerts, type AlertSeverity } from "@/server/queries/anomalies";
import { dismissAlertAction, snoozeAlertAction } from "./anomaly-actions";

/**
 * "Auffälligkeiten" widget on the praxis dashboard. Renders up to 5 active
 * anomaly alerts produced by the anomaly-scan worker. Three states:
 *
 *   1. Empty: praxis is steady. Shows a one-liner so the widget doesn't
 *      look broken.
 *   2. Alerts without action steps (info-only or auto-recovering): just
 *      the headline + observed-vs-baseline body, no "Nächste Schritte"
 *      section. This is the "wenn der Inhaber nichts machen muss, dann
 *      sollten da keine Action steps geben" requirement.
 *   3. Alerts with action steps: rule-default steps + (rarely) a
 *      KI-tagged extra step or two for extreme/multi-signal cases.
 *
 * Both dismiss (hide forever) and snooze (hide 7 days) submit plain form
 * server actions so the widget stays a pure server component with no
 * client JS shipped for the common path.
 */

export async function AnomalyAlertsWidget({
  clinicId,
  userId,
}: {
  clinicId: string;
  userId: string;
}) {
  const alerts = await getActiveAlerts(clinicId, userId, 5);

  return (
    <Card
      className="print:break-inside-avoid"
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 !text-xl !font-medium md:!text-2xl">
          <span>Auffälligkeiten</span>
          <ExplainerPopover term="Auffälligkeiten" ariaLabel="Erklärung für Auffälligkeiten">
            <p>
              Was diese Woche von Ihrer Baseline abweicht und Aufmerksamkeit
              braucht.
            </p>
          </ExplainerPopover>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <EmptyAlertsState />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="rounded-xl border border-border bg-bg-primary p-4 shadow-sm"
              >
                <AlertRow alert={a} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyAlertsState() {
  return (
    <p className="text-base text-fg-primary">
      Aktuell keine Auffälligkeiten. Hier erscheinen Hinweise, sobald genug
      Daten vorliegen und eine Kennzahl deutlich von den Vorwochen abweicht.
    </p>
  );
}

function AlertRow({
  alert,
}: {
  alert: Awaited<ReturnType<typeof getActiveAlerts>>[number];
}) {
  const tone = severityTone(alert.severity);
  const hasRuleSteps = alert.actionSteps.length > 0;
  const hasAiSteps = (alert.aiActionSteps?.length ?? 0) > 0;
  const showSteps = hasRuleSteps || hasAiSteps;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dotClass}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="font-medium text-fg-primary">{alert.title}</p>
            <form action={dismissAlertAction}>
              <input type="hidden" name="alertId" value={alert.id} />
              <button
                type="submit"
                aria-label="Auffälligkeit ausblenden"
                title="Ausblenden"
                className="opa-focus-ring -mr-1 -mt-1 rounded-md p-1 text-fg-tertiary hover:bg-bg-tertiary hover:text-fg-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </form>
          </div>
        </div>
      </div>

      {showSteps && (
        <div className="ml-[1.375rem] flex flex-col gap-1.5">
          <p className="text-sm font-medium text-fg-primary">
            Nächste Schritte
          </p>
          <ul className="flex flex-col gap-1 text-sm text-fg-primary">
            {alert.actionSteps.map((step, idx) => (
              <li key={`rule-${idx}`} className="flex gap-2">
                <span aria-hidden className="text-fg-tertiary">
                  •
                </span>
                <span>{step}</span>
              </li>
            ))}
            {alert.aiActionSteps?.map((step, idx) => (
              <li key={`ai-${idx}`} className="flex gap-2">
                <span
                  aria-hidden
                  className="inline-flex h-5 shrink-0 items-center gap-1 rounded border border-accent px-1.5 text-sm font-medium text-fg-primary"
                  title="Von KI ergänzt, weil der Fall ungewöhnlich ist"
                >
                  <Sparkles className="h-3 w-3 text-accent" />
                  KI
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ml-[1.375rem] flex items-center gap-3 text-sm text-fg-primary">
        <form action={snoozeAlertAction}>
          <input type="hidden" name="alertId" value={alert.id} />
          <button
            type="submit"
            className="opa-focus-ring rounded px-1 py-0.5 underline-offset-2 hover:bg-bg-tertiary hover:underline"
          >
            7 Tage später erinnern
          </button>
        </form>
      </div>
    </div>
  );
}

interface SeverityTone {
  dotClass: string;
}

function severityTone(severity: AlertSeverity): SeverityTone {
  switch (severity) {
    case "extreme":
      return { dotClass: "bg-tone-bad ring-2 ring-[var(--tone-bad-border)]" };
    case "high":
      return { dotClass: "bg-tone-bad" };
    case "warn":
      return { dotClass: "bg-tone-warn" };
    case "info":
    default:
      return { dotClass: "bg-fg-tertiary" };
  }
}

export function AnomalyAlertsSkeleton() {
  return (
    <Card
      style={{
        backgroundColor: "var(--bg-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <CardHeader>
        <CardTitle className="!text-xl !font-medium md:!text-2xl">
          Auffälligkeiten
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-3 text-sm text-fg-secondary">
          <AlertTriangle className="h-4 w-4" aria-hidden />
          Lade Auffälligkeiten…
        </div>
      </CardContent>
    </Card>
  );
}
