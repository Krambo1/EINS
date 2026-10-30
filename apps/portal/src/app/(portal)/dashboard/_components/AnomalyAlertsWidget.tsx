import "server-only";
import { getActiveAlerts } from "@/server/queries/anomalies";
import { AlertsCard } from "./AlertsCard";

/**
 * "Auffälligkeiten" widget on the praxis dashboard. Renders up to 5 active
 * anomaly alerts produced by the anomaly-scan worker. Three states:
 *
 *   1. Empty: praxis is steady. A one-liner without a card, so a quiet
 *      week doesn't take a whole card on the page.
 *   2. Alerts without action steps (info-only or auto-recovering): just
 *      the headline + observed-vs-baseline body, no "Nächste Schritte"
 *      section. This is the "wenn der Inhaber nichts machen muss, dann
 *      sollten da keine Action steps geben" requirement.
 *   3. Alerts with action steps: rule-default steps + (rarely) a
 *      KI-tagged extra step or two for extreme/multi-signal cases.
 *
 * Dismiss (hide forever) and snooze (hide 7 days) live in the client
 * `AlertsCard`: the alert leaves the screen on the tap, the server action
 * runs in the background, a failure brings it back with a toast.
 */

export async function AnomalyAlertsWidget({
  clinicId,
  userId,
}: {
  clinicId: string;
  userId: string;
}) {
  const alerts = await getActiveAlerts(clinicId, userId, 5);

  // Nothing unusual, nothing shown: an "all fine" line changes no decision.
  if (alerts.length === 0) return null;

  return (
    <AlertsCard
      alerts={alerts.map((a) => ({
        id: a.id,
        title: a.title,
        severity: a.severity,
        actionSteps: a.actionSteps,
        aiActionSteps: a.aiActionSteps ?? null,
      }))}
    />
  );
}

/** Nothing while loading: the card only appears when there is something to say. */
export function AnomalyAlertsSkeleton() {
  return null;
}
