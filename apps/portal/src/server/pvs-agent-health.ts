import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";

/**
 * PVS agent health: turn the on-prem agent's heartbeat telemetry into
 * dashboard alerts (migration 0069).
 *
 * WHY THIS EXISTS
 *
 * `pvs_agent_status.failed_events` is a DEAD-LETTER counter: it only counts
 * events that were read, attempted and permanently rejected. The failure
 * modes that actually kill a fresh install produce zero events AND zero
 * failures, which in the portal is indistinguishable from a quiet week at
 * the Praxis:
 *
 *   * the GDT export folder moved / the network share remapped
 *   * startRunner threw, so no DB-adapter stream is running at all
 *   * one stream halted on schema drift while the others keep flowing
 *   * the outbox queues and retries forever behind a new firewall rule
 *   * the agent stopped heartbeating entirely
 *   * everything looks healthy but no event has arrived in days
 *
 * The first four are visible in a single heartbeat and are evaluated here on
 * ingest. The last two need a clock and the link row, so the hourly worker
 * scan (worker/processors/pvs-agent-health-scan.ts) evaluates those and
 * reconciles through the same helper.
 *
 * ALERT LIFECYCLE
 *
 * All conditions share kind `pvs_agent_health` and a dedupe key of
 * `pvs_agent_health:<conditionKey>`. Reconciliation is declarative: callers
 * pass the FULL set of conditions currently true for their evaluation scope,
 * and any alert in that scope which is no longer true is DELETED.
 *
 * Deleted, not `dismissed_at`-stamped, on purpose. `dismissed_at` is the
 * operator's own "I have seen this" action. If auto-resolve reused it, a
 * condition that cleared and later came back would find a dismissed row and
 * stay silent forever. Deleting keeps the two mechanisms separate: an
 * operator dismissal survives while the condition holds, and the row is
 * removed once the underlying problem is genuinely gone.
 */

/** Alert kind shared by every agent-health condition. */
export const AGENT_HEALTH_ALERT_KIND = "pvs_agent_health";

/**
 * Heartbeats arrive every 60s. Five minutes of silence is three missed beats:
 * long enough to rule out a single dropped request or a portal deploy, short
 * enough that an operator learns about a dead agent the same morning.
 */
export const HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/**
 * "Healthy agent, no events at all" threshold, measured in BUSINESS time.
 *
 * A wall-clock threshold does not work here. A Praxis that closes Friday
 * midday is legitimately silent until Monday morning, which is ~72h, so a 72h
 * wall-clock rule fires a high-severity alert on a Praxis that is open and
 * working normally. An operator learns to ignore an alert like that in about
 * two weeks, at which point the alert is worse than not having one.
 *
 * Counting only Monday to Friday makes the threshold mean what it says: two
 * working days without a single event. A Friday-midday close reaches Monday
 * afternoon at ~25 business hours and stays quiet; a genuinely dead install
 * crosses 48 business hours and fires.
 *
 * This is deliberately the SLOW backstop. The explicit signals above catch a
 * moved folder or a dead runner within one heartbeat; this only has to cover
 * failure modes that emit no signal at all.
 */
export const SILENT_STALL_BUSINESS_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Elapsed milliseconds between two instants, excluding Saturdays and Sundays.
 *
 * Weekdays are taken in UTC rather than Europe/Berlin. The offset is one or
 * two hours, which cannot move a 48-BUSINESS-hour threshold across a decision
 * boundary in any way an operator would notice, and it keeps this function
 * free of timezone data. If the gap is longer than a year we stop counting and
 * return the raw span: the clinic is unambiguously stalled either way, and the
 * loop must stay bounded.
 */
export function businessMsBetween(from: Date, to: Date): number {
  const total = to.getTime() - from.getTime();
  if (total <= 0) return 0;
  if (total > 400 * DAY_MS) return total;

  let weekendMs = 0;
  let cursor = Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth(),
    from.getUTCDate()
  );
  while (cursor < to.getTime()) {
    const dow = new Date(cursor).getUTCDay();
    if (dow === 0 || dow === 6) {
      const start = Math.max(cursor, from.getTime());
      const end = Math.min(cursor + DAY_MS, to.getTime());
      if (end > start) weekendMs += end - start;
    }
    cursor += DAY_MS;
  }
  return total - weekendMs;
}

/** Stream states that mean the stream is halted and will not self-recover. */
const HALTED_STREAM_STATUSES = new Set(["error", "schema_drift", "config_invalid"]);

export interface AdapterStatusSnapshot {
  vendor: string;
  stream: string;
  status: string;
  lastError: string | null;
  connectError: string | null;
}

/** The health-bearing slice of one heartbeat. */
export interface AgentHeartbeatHealth {
  stalePendingEvents: number;
  missingFolders: string[];
  dbAdaptersFailed: string | null;
  adapterStatuses: AdapterStatusSnapshot[];
}

export interface AgentHealthCondition {
  /** Stable per-condition key; becomes the dedupe-key suffix. */
  key: string;
  severity: "warn" | "high";
  title: string;
  body: string;
  actionSteps: string[];
  metric: string;
  /** Free-text observed value. NOT numeric: dashboard_alerts.observed_value
   *  is numeric(14,4), so descriptive values ride in the body instead. */
  observedValue: number | null;
}

/**
 * Conditions derivable from a single heartbeat payload. Pure, so the ingest
 * route can call it on the hot path and the tests can exercise every branch
 * without a database.
 */
export function evaluateHeartbeatHealth(
  hb: AgentHeartbeatHealth
): AgentHealthCondition[] {
  const conditions: AgentHealthCondition[] = [];

  if (hb.missingFolders.length > 0) {
    const list = hb.missingFolders.join(", ");
    conditions.push({
      key: "folder_missing",
      severity: "high",
      title: "PVS-Agent findet den Export-Ordner nicht",
      body:
        `Der Agent auf dem Praxis-Rechner kann ${
          hb.missingFolders.length > 1 ? "diese Pfade" : "diesen Pfad"
        } nicht öffnen: ${list}. Solange der Pfad fehlt, liest der Agent keine ` +
        "einzige Datei ein. Er meldet sich weiter im Minutentakt und zeigt null " +
        "Fehler an, weil es nichts zu verarbeiten gibt. Es kommen aber auch keine " +
        "Umsätze und keine Termine mehr an.",
      actionSteps: [
        "Prüfen, ob der Ordner auf dem Praxis-Rechner noch existiert und ob sich der Laufwerksbuchstabe geändert hat.",
        "Bei einem Netzlaufwerk: prüfen, ob die Freigabe beim Start verbunden wird. Ein nur im Explorer verbundenes Laufwerk fehlt dem Dienst.",
        "Nach der Korrektur den Pfad in der Agent-Konfiguration anpassen und den Agent neu starten.",
      ],
      metric: "pvs_agent_missing_folders",
      observedValue: hb.missingFolders.length,
    });
  }

  if (hb.dbAdaptersFailed) {
    conditions.push({
      key: "adapters_down",
      severity: "high",
      title: "PVS-Datenbank-Anbindung ist nicht gestartet",
      body:
        "Der Agent konnte beim Start keine Verbindung zur PVS-Datenbank aufbauen: " +
        `${hb.dbAdaptersFailed}. Es läuft aktuell keine einzige Datenbank-Abfrage. ` +
        "Häufigste Ursache: Die Zugangsdaten wurden nach einem PVS-Update geändert " +
        "oder der Datenbank-Dienst ist nach einem Neustart nicht wieder hochgekommen.",
      actionSteps: [
        "Prüfen, ob der Datenbank-Dienst des PVS auf dem Server läuft.",
        "Zugangsdaten prüfen. Nach einem PVS-Update werden sie gelegentlich zurückgesetzt.",
        "Zugangsdaten im Agent neu hinterlegen und den Agent neu starten.",
      ],
      metric: "pvs_agent_adapters_failed",
      observedValue: 1,
    });
  }

  const halted = hb.adapterStatuses.filter(
    (a) => HALTED_STREAM_STATUSES.has(a.status) || a.connectError !== null
  );
  if (halted.length > 0) {
    const detail = halted
      .map((a) => {
        const reason = a.connectError ?? a.lastError ?? a.status;
        return `${a.vendor}/${a.stream}: ${reason}`;
      })
      .join(" · ");
    conditions.push({
      key: "stream_halted",
      severity: "high",
      title: `PVS: ${halted.length} Datenstrom${
        halted.length > 1 ? "e sind" : " ist"
      } angehalten`,
      body:
        `Folgende Datenströme liefern nichts mehr: ${detail}. Die übrigen Ströme ` +
        "laufen weiter, deshalb sieht die Anbindung auf den ersten Blick gesund aus. " +
        "Ein angehaltener Strom startet nicht von selbst neu: Er wartet auf eine " +
        "Korrektur der Konfiguration oder der Zugangsdaten.",
      actionSteps: [
        "Den genannten Grund prüfen. 'schema_drift' heißt: Eine Spalte im PVS wurde umbenannt oder entfernt.",
        "Bei einem Verbindungsfehler die Zugangsdaten des betroffenen Anbieters erneuern.",
        "Nach der Korrektur den Agent neu starten, damit der Strom wieder anläuft.",
      ],
      metric: "pvs_agent_halted_streams",
      observedValue: halted.length,
    });
  }

  if (hb.stalePendingEvents > 0) {
    conditions.push({
      key: "backlog_stuck",
      severity: "high",
      title: `PVS-Agent kann ${hb.stalePendingEvents} Ereignis${
        hb.stalePendingEvents > 1 ? "se" : ""
      } nicht übertragen`,
      body:
        `${hb.stalePendingEvents} Ereignis${
          hb.stalePendingEvents > 1 ? "se liegen" : " liegt"
        } seit über einer Stunde auf dem Praxis-Rechner und ` +
        "kommen nicht im Portal an. Der Agent versucht es weiter, deshalb steht der " +
        "Dead-Letter-Zähler auf null. Die Daten sind nicht verloren, aber die " +
        "Auswertung im Portal ist so lange unvollständig.",
      actionSteps: [
        "Prüfen, ob der Praxis-Rechner ins Internet kommt und ob eine neue Firewall-Regel den Zugriff auf das Portal blockt.",
        "Prüfen, ob ein Proxy im Netz der Praxis zwischengeschaltet wurde.",
        "Läuft die Verbindung wieder, überträgt der Agent den Rückstand von selbst. Es geht nichts verloren.",
      ],
      metric: "pvs_agent_stale_pending",
      observedValue: hb.stalePendingEvents,
    });
  }

  return conditions;
}

/**
 * Conditions that need wall-clock context rather than the payload: the agent
 * gone silent, and the "healthy but delivering nothing" stall. Pure for the
 * same reason as above; `now` is injected so tests do not depend on the clock.
 */
export function evaluateAgentLiveness(input: {
  lastHeartbeatAt: Date;
  lastEventAt: Date | null;
  /**
   * When this agent was first seen (pvs_agent_status.created_at). Used as the
   * stall clock for a clinic that has NEVER delivered an event: `lastEventAt`
   * stays null forever in that case, and keying off it alone would exempt the
   * single worst outcome, an install that never worked at all, from the only
   * check designed to catch it.
   */
  agentFirstSeenAt: Date;
  now: Date;
}): AgentHealthCondition[] {
  const conditions: AgentHealthCondition[] = [];
  const heartbeatAgeMs = input.now.getTime() - input.lastHeartbeatAt.getTime();

  if (heartbeatAgeMs > HEARTBEAT_STALE_MS) {
    const minutes = Math.floor(heartbeatAgeMs / 60_000);
    conditions.push({
      key: "heartbeat_stale",
      severity: "high",
      title: "PVS-Agent meldet sich nicht mehr",
      body:
        `Der Agent auf dem Praxis-Rechner hat sich seit ${minutes} Minuten nicht ` +
        "gemeldet. Erwartet wird eine Meldung pro Minute. Entweder ist der Rechner " +
        "aus, der Dienst wurde beendet, oder die Praxis hat keine Internetverbindung. " +
        "Bereits erfasste Daten bleiben auf dem Rechner erhalten und werden nach " +
        "einem Neustart nachgeliefert.",
      actionSteps: [
        "Prüfen, ob der Praxis-Rechner läuft und nicht im Ruhezustand ist.",
        "Prüfen, ob der EINS-Agent-Dienst gestartet ist, und ihn gegebenenfalls neu starten.",
        "Bleibt es dabei, die Internetverbindung der Praxis prüfen.",
      ],
      metric: "pvs_agent_heartbeat_age_minutes",
      observedValue: minutes,
    });
    // A silent agent explains the absence of events by itself. Raising the
    // stall alert on top would be the same incident reported twice.
    return conditions;
  }

  // Never-delivered installs fall back to the enrollment time, so "it has not
  // worked once since we set it up" is caught by the same rule.
  const neverDelivered = input.lastEventAt === null;
  const since = input.lastEventAt ?? input.agentFirstSeenAt;
  const businessMs = businessMsBetween(since, input.now);
  if (businessMs > SILENT_STALL_BUSINESS_MS) {
    const workdays = Math.floor(businessMs / DAY_MS);
    conditions.push({
      key: "silent_stall",
      severity: "high",
      title: neverDelivered
        ? "PVS-Anbindung hat noch nie Daten geliefert"
        : "PVS-Anbindung meldet sich, liefert aber keine Daten",
      body: neverDelivered
        ? "Der Agent läuft und meldet sich normal, aber seit der Einrichtung ist " +
          "noch kein einziges Ereignis angekommen. Die Anbindung wurde also nie " +
          "fertig eingerichtet. Typische Ursachen: Im PVS ist der Export nicht " +
          "aktiviert, oder er schreibt in einen anderen als den überwachten Ordner."
        : `Der Agent läuft und meldet sich normal, aber seit rund ${workdays} ` +
          "Arbeitstagen ist kein einziges Ereignis mehr angekommen. Wochenenden " +
          "sind dabei nicht mitgezählt. Typische Ursachen: Das PVS exportiert " +
          "nicht mehr in den überwachten Ordner, oder eine Einstellung im PVS " +
          "wurde bei einem Update zurückgesetzt.",
      actionSteps: neverDelivered
        ? [
            "Im PVS prüfen, ob der Export überhaupt aktiviert ist.",
            "Prüfen, ob der Export-Pfad im PVS und der überwachte Ordner im Agent derselbe sind.",
            "Zum Test eine Abrechnung im PVS auslösen und prüfen, ob eine Datei im überwachten Ordner erscheint.",
          ]
        : [
            "In der Praxis nachfragen, ob normal abgerechnet wurde. Eine längere Schließung erklärt den Stillstand.",
            "Prüfen, ob im PVS noch in den überwachten Ordner exportiert wird. Nach einem Update ist die Einstellung gelegentlich zurückgesetzt.",
            "Prüfen, ob im Export-Ordner neue Dateien ankommen. Liegen dort Dateien, ohne dass Ereignisse eintreffen, ist es ein Agent-Problem.",
          ],
      metric: "pvs_agent_event_age_workdays",
      observedValue: workdays,
    });
  }

  return conditions;
}

/**
 * Write the given conditions to dashboard_alerts and remove the ones in
 * `scopeKeys` that are no longer true.
 *
 * `scopeKeys` is what makes two independent callers safe: the ingest route
 * owns the heartbeat-derived keys and the worker owns the liveness keys, so
 * neither can delete the other's alerts by reporting an empty condition list.
 *
 * THROWS on failure. Callers decide what a failed write means: the ingest path
 * swallows it (losing an alert write must never fail a heartbeat), the hourly
 * scan counts it so the run summary is honest about how many clinics it
 * actually reconciled.
 */
export async function reconcileAgentHealthAlerts(
  clinicId: string,
  conditions: AgentHealthCondition[],
  scopeKeys: readonly string[]
): Promise<void> {
  const dedupeKey = (key: string) => `${AGENT_HEALTH_ALERT_KIND}:${key}`;
  {
    for (const c of conditions) {
      await db
        .insert(schema.dashboardAlerts)
        .values({
          clinicId,
          kind: AGENT_HEALTH_ALERT_KIND,
          severity: c.severity,
          title: c.title,
          body: c.body,
          actionSteps: c.actionSteps,
          metric: c.metric,
          observedValue:
            c.observedValue === null ? null : String(c.observedValue),
          dedupeKey: dedupeKey(c.key),
        })
        .onConflictDoUpdate({
          target: [
            schema.dashboardAlerts.clinicId,
            schema.dashboardAlerts.dedupeKey,
          ],
          set: {
            // The condition can change shape while staying true (one missing
            // folder becomes three), so refresh the operator-visible text.
            severity: c.severity,
            title: c.title,
            body: c.body,
            actionSteps: c.actionSteps,
            observedValue:
              c.observedValue === null ? null : String(c.observedValue),
            updatedAt: new Date(),
          },
        });
    }

    // Resolve: delete this scope's alerts whose condition no longer holds.
    // See the lifecycle note above for why this deletes instead of dismissing.
    const activeKeys = new Set(conditions.map((c) => c.key));
    const resolvedKeys = scopeKeys
      .filter((k) => !activeKeys.has(k))
      .map(dedupeKey);
    if (resolvedKeys.length > 0) {
      await db
        .delete(schema.dashboardAlerts)
        .where(
          and(
            eq(schema.dashboardAlerts.clinicId, clinicId),
            eq(schema.dashboardAlerts.kind, AGENT_HEALTH_ALERT_KIND),
            inArray(schema.dashboardAlerts.dedupeKey, resolvedKeys)
          )
        );
    }
  }
}

/** Condition keys owned by the heartbeat ingest path. */
export const HEARTBEAT_SCOPE_KEYS = [
  "folder_missing",
  "adapters_down",
  "stream_halted",
  "backlog_stuck",
] as const;

/** Condition keys owned by the hourly liveness scan. */
export const LIVENESS_SCOPE_KEYS = ["heartbeat_stale", "silent_stall"] as const;

/**
 * Compact, comparable summary of the health slice of a heartbeat. The ingest
 * route reconciles alerts only when this changes, so the steady state (a
 * healthy agent beating every 60s) costs zero alert writes.
 */
export function healthSignature(hb: AgentHeartbeatHealth): string {
  const streams = hb.adapterStatuses
    .map(
      (a) =>
        // The halt REASON is part of the signature, not just the status: the
        // alert body renders `connectError ?? lastError ?? status`, so a stream
        // that stays in 'error' while its reason changes would otherwise keep
        // showing the operator the first error forever.
        `${a.vendor}/${a.stream}=${a.status}:${a.connectError ?? a.lastError ?? ""}`
    )
    .sort()
    .join(",");
  return [
    // Bucketed by order of magnitude. A backlog ticking 3 to 4 to 5 is the same
    // incident and must not rewrite the alert row on every heartbeat, but the
    // count is rendered IN the alert text, so 3 growing to 5 000 has to refresh
    // it or the operator reads a number that is off by three orders.
    magnitudeBucket(hb.stalePendingEvents),
    [...hb.missingFolders].sort().join("|"),
    hb.dbAdaptersFailed ?? "",
    streams,
  ].join("§");
}

/** 0, then one bucket per power of ten. */
function magnitudeBucket(n: number): string {
  if (n <= 0) return "0";
  return `1e${Math.floor(Math.log10(n))}`;
}
