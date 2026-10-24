import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db/client";
import { notifyOps } from "@/server/ops-alerts";

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

/** Outside Berlin working hours the PC may simply be off: wait 14 h. */
export const HEARTBEAT_STALE_OFF_HOURS_MS = 14 * 60 * 60 * 1000;

/** Enrolled but never heartbeated for this long raises `heartbeat_never`. */
export const HEARTBEAT_NEVER_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * "Healthy agent, no events at all" threshold, measured in BUSINESS time.
 *
 * A wall-clock threshold does not work here. A Praxis that closes Friday
 * midday is legitimately silent until Monday morning, which is ~72h, so a 72h
 * wall-clock rule fires a high-severity alert on a Praxis that is open and
 * working normally. An operator learns to ignore an alert like that in about
 * two weeks, at which point the alert is worse than not having one.
 *
 * Counting only Berlin working days (no weekends, no German holidays) makes
 * the threshold mean what it says: two working days without a single event. A Friday-midday close reaches Monday
 * afternoon at ~25 business hours and stays quiet; a genuinely dead install
 * crosses 48 business hours and fires.
 *
 * This is deliberately the SLOW backstop. The explicit signals above catch a
 * moved folder or a dead runner within one heartbeat; this only has to cover
 * failure modes that emit no signal at all.
 */
export const SILENT_STALL_BUSINESS_MS = 48 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Europe/Berlin calendar helpers
//
// "Business time" is a Berlin concept: a Praxis in Munich is closed on
// Karfreitag and Pfingstmontag, not on whatever UTC thinks is a weekday.
// Everything below works on Berlin calendar days (DST-aware: 23 or 25 hours on
// the two switch days) and a small computed list of German federal holidays.
// ---------------------------------------------------------------------------

const BERLIN_TZ = "Europe/Berlin";

const berlinFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: BERLIN_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface BerlinParts {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
}

function berlinParts(at: Date): BerlinParts {
  const out: Record<string, number> = {};
  for (const p of berlinFormatter.formatToParts(at)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    y: out.year!,
    m: out.month!,
    d: out.day!,
    h: out.hour!,
    min: out.minute!,
    s: out.second!,
  };
}

/** Berlin wall clock minus UTC at the given instant, in ms (3.6e6 or 7.2e6). */
function berlinOffsetMs(at: Date): number {
  const p = berlinParts(at);
  const wallAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return wallAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant at which the given Berlin calendar day starts. */
function berlinMidnightUtc(y: number, m: number, d: number): number {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - berlinOffsetMs(new Date(guess));
  return guess - berlinOffsetMs(new Date(first));
}

/** Gregorian Easter Sunday (Anonymous algorithm) as {m, d}. */
function easterSunday(year: number): { m: number; d: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { m: month, d: day };
}

const ymdKey = (y: number, m: number, d: number) => y * 10_000 + m * 100 + d;

const holidayCache = new Map<number, ReadonlySet<number>>();

/**
 * Days a Praxis is normally closed, besides Saturday and Sunday: the German
 * FEDERAL public holidays (Neujahr, Karfreitag, Ostermontag, 1. Mai, Christi
 * Himmelfahrt, Pfingstmontag, 3. Oktober, 25./26. Dezember) plus the usual
 * Brueckentage and quiet days (Freitag nach Himmelfahrt, 24. und 31. Dezember).
 * State-only holidays (Fronleichnam, Allerheiligen, ...) are deliberately left
 * out: counting them would hide a real outage in the states that work through.
 */
export function germanClosedDays(year: number): ReadonlySet<number> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const set = new Set<number>();
  const add = (m: number, d: number) => set.add(ymdKey(year, m, d));
  add(1, 1);
  add(5, 1);
  add(10, 3);
  add(12, 24);
  add(12, 25);
  add(12, 26);
  add(12, 31);
  const easter = easterSunday(year);
  for (const offset of [-2, 1, 39, 40, 50]) {
    const t = new Date(Date.UTC(year, easter.m - 1, easter.d + offset));
    set.add(ymdKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()));
  }
  holidayCache.set(year, set);
  return set;
}

function isClosedBerlinDay(y: number, m: number, d: number): boolean {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  if (dow === 0 || dow === 6) return true;
  return germanClosedDays(y).has(ymdKey(y, m, d));
}

/**
 * True on a Berlin weekday that is not a closed day, between 07:00 and 19:00
 * local time: the window in which a Praxis PC is expected to be switched on.
 */
export function isBerlinBusinessHours(at: Date): boolean {
  const p = berlinParts(at);
  if (isClosedBerlinDay(p.y, p.m, p.d)) return false;
  return p.h >= 7 && p.h < 19;
}

/**
 * Elapsed milliseconds between two instants, excluding Berlin Saturdays,
 * Sundays and German closed days (see germanClosedDays). If the gap is longer
 * than a year we stop counting and return the raw span: the clinic is
 * unambiguously stalled either way, and the loop must stay bounded.
 */
export function businessMsBetween(from: Date, to: Date): number {
  const total = to.getTime() - from.getTime();
  if (total <= 0) return 0;
  if (total > 400 * DAY_MS) return total;

  let closedMs = 0;
  const start = berlinParts(from);
  let y = start.y;
  let m = start.m;
  let d = start.d;
  let dayStart = berlinMidnightUtc(y, m, d);
  while (dayStart < to.getTime()) {
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    const ny = next.getUTCFullYear();
    const nm = next.getUTCMonth() + 1;
    const nd = next.getUTCDate();
    const dayEnd = berlinMidnightUtc(ny, nm, nd);
    if (isClosedBerlinDay(y, m, d)) {
      const lo = Math.max(dayStart, from.getTime());
      const hi = Math.min(dayEnd, to.getTime());
      if (hi > lo) closedMs += hi - lo;
    }
    y = ny;
    m = nm;
    d = nd;
    dayStart = dayEnd;
  }
  return total - closedMs;
}

/**
 * Stream states that need a human. Most will not self-recover. suspect_empty
 * keeps polling, but it means the stream has never returned a row although
 * its table has rows (usually a wrong status literal), so revenue silently
 * stays at zero. auth_failed stops connecting until the credential changes,
 * so a shared vendor account is not locked out by retries.
 */
const HALTED_STREAM_STATUSES = new Set([
  "error",
  "schema_drift",
  "config_invalid",
  "suspect_empty",
  "auth_failed",
]);

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
  /**
   * Agent clock minus portal clock, seconds, from the latest heartbeat.
   * Undefined/null = unknown (e.g. evaluated from stored state of a row that
   * predates 0079): no skew condition.
   */
  clockSkewSeconds?: number | null;
  /**
   * Why uploads are not flowing, in German, from the agent's own upload state
   * (see deriveUploadReason). Undefined/null = the agent did not say; the
   * backlog alert then keeps its generic text.
   */
  uploadReason?: string | null;
  /**
   * Dead-letter movement for THIS heartbeat: the reported failed count, the
   * stored count it is compared with, and the top reasons. Only the ingest
   * route fills it; the hourly scan has no "previous beat" to compare with.
   */
  deadLetter?: { count: number; priorCount: number; reasons: string[] } | null;
}

/** The agent's upload diagnostics as stored in pvs_agent_status.upload_diagnostics. */
export interface UploadDiagnostics {
  uploadState?: {
    authPaused?: boolean;
    lastBatchError?: string | null;
    consecutiveTransientFailures?: number;
  } | null;
  pendingReasons?: Array<{ reason: string; count: number }> | null;
}

/**
 * One short German phrase naming why events are stuck, or null when the agent
 * gave no reason. Order: the agent is not signed in (nothing else matters), the
 * last batch error, then the most common reason among rows that already failed.
 * The heartbeat arriving at all proves the network is fine, so a reason here
 * is more useful than the generic "check the firewall".
 */
export function deriveUploadReason(
  d: UploadDiagnostics | null | undefined
): string | null {
  if (!d) return null;
  if (d.uploadState?.authPaused) {
    return "Das Portal lehnt die Anmeldung oder Signatur des Agents ab (Anmeldung/Signatur)";
  }
  const batch = d.uploadState?.lastBatchError;
  if (batch && (d.uploadState?.consecutiveTransientFailures ?? 0) > 0) {
    return `Letzter Upload-Fehler laut Agent: ${batch.slice(0, 200)}`;
  }
  const top = d.pendingReasons?.[0]?.reason;
  if (top) return `Häufigster Grund laut Agent: ${top.slice(0, 200)}`;
  return null;
}

/** |skew| above this raises `agent_clock_skew`. */
export const CLOCK_SKEW_THRESHOLD_SECONDS = 5 * 60;

export interface AgentHealthCondition {
  /** Stable per-condition key; becomes the dedupe-key suffix. */
  key: string;
  /** "warn" is the low tier (dashboard_alerts has no "low"); "high" pages ops. */
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
        "'suspect_empty' heißt: Die Tabelle hat Zeilen, die Abfrage findet aber keine. Meist passt das Status-Literal nicht (die gefundenen Statuswerte stehen im Grund).",
        "'auth_failed' heißt: Die Datenbank lehnt die Zugangsdaten ab. Der Agent versucht es erst wieder, wenn neue Zugangsdaten hinterlegt sind.",
        "Bei einem Verbindungsfehler die Zugangsdaten des betroffenen Anbieters erneuern.",
        "Nach der Korrektur den Agent neu starten, damit der Strom wieder anläuft.",
      ],
      metric: "pvs_agent_halted_streams",
      observedValue: halted.length,
    });
  }

  if (hb.stalePendingEvents > 0) {
    const reason = hb.uploadReason ?? null;
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
        "Auswertung im Portal ist so lange unvollständig." +
        (reason
          ? ` ${reason}. Die Meldungen des Agents kommen an, das Netz ist also in Ordnung.`
          : ""),
      actionSteps: reason
        ? [
            `Ursache beheben: ${reason}.`,
            "Danach überträgt der Agent den Rückstand von selbst. Es geht nichts verloren.",
          ]
        : [
            "Prüfen, ob der Praxis-Rechner ins Internet kommt und ob eine neue Firewall-Regel den Zugriff auf das Portal blockt.",
            "Prüfen, ob ein Proxy im Netz der Praxis zwischengeschaltet wurde.",
            "Läuft die Verbindung wieder, überträgt der Agent den Rückstand von selbst. Es geht nichts verloren.",
          ],
      metric: "pvs_agent_stale_pending",
      observedValue: hb.stalePendingEvents,
    });
  }

  if (hb.deadLetter && hb.deadLetter.count > hb.deadLetter.priorCount) {
    const { count, priorCount, reasons } = hb.deadLetter;
    const added = count - priorCount;
    conditions.push({
      key: "dead_letter",
      severity: "high",
      title: `PVS-Agent: ${count} Ereignis${count > 1 ? "se" : ""} vom Portal endgültig abgelehnt`,
      body:
        `Beim letzten Abgleich sind ${added} Ereignis${added > 1 ? "se" : ""} ` +
        `hinzugekommen, die das Portal endgültig abgelehnt hat (insgesamt ${count}). ` +
        (reasons.length > 0
          ? `Häufigste Gründe: ${reasons.join(" · ")}. `
          : "") +
        "Diese Ereignisse werden nicht erneut gesendet und fehlen in der Auswertung, " +
        "bis sie von Hand wieder freigegeben werden.",
      actionSteps: [
        "Den genannten Grund prüfen. Häufige Ursachen: ein fehlerhaftes Update von Agent oder Portal oder eine falsche Portal-Adresse.",
        "Nach der Korrektur auf dem Praxis-Rechner 'eins-agent --requeue-failed' ausführen (mit '--reason <Code>' nur für einen Grund). Der Agent sendet die Ereignisse dann erneut.",
        "Der Alarm verschwindet, sobald die Zahl der abgelehnten Ereignisse wieder bei null liegt.",
      ],
      metric: "pvs_agent_dead_letter_events",
      observedValue: count,
    });
  }

  if (
    hb.clockSkewSeconds !== undefined &&
    hb.clockSkewSeconds !== null &&
    Math.abs(hb.clockSkewSeconds) > CLOCK_SKEW_THRESHOLD_SECONDS
  ) {
    const minutes = Math.round(Math.abs(hb.clockSkewSeconds) / 60);
    const ahead = hb.clockSkewSeconds > 0;
    conditions.push({
      key: "agent_clock_skew",
      severity: "warn",
      title: "Uhr des PVS-Agent-Rechners geht falsch",
      body:
        `Die Systemuhr des Praxis-Rechners geht rund ${minutes} Minuten ` +
        `${ahead ? "vor" : "nach"}. Die Zeitstempel der gemeldeten Ereignisse ` +
        "stammen von dieser Uhr, deshalb können Umsätze und Termine am falschen " +
        "Tag oder in der falschen Reihenfolge landen. Die Überwachung selbst " +
        "rechnet mit der Portal-Uhr und ist nicht betroffen.",
      actionSteps: [
        "Datum, Uhrzeit und Zeitzone des Praxis-Rechners prüfen.",
        "Automatische Zeitsynchronisierung (Windows-Zeitdienst) aktivieren und einmal manuell synchronisieren.",
        "Den Agent danach neu starten.",
      ],
      metric: "pvs_agent_clock_skew_minutes",
      observedValue: ahead ? minutes : -minutes,
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
  /**
   * pvs_agent_status.first_heartbeat_at. `null` = the row was seeded at
   * enrollment and the agent has never beaten. `undefined` (older callers)
   * is treated as "has beaten".
   */
  firstHeartbeatAt?: Date | null;
  now: Date;
}): AgentHealthCondition[] {
  const conditions: AgentHealthCondition[] = [];

  if (input.firstHeartbeatAt === null) {
    // Enrolled, never beaten: lastHeartbeatAt is just the seed time, so none
    // of the clocks below mean anything. One condition, after a grace period
    // that covers a slow installer.
    const sinceEnrollMs = input.now.getTime() - input.agentFirstSeenAt.getTime();
    if (sinceEnrollMs > HEARTBEAT_NEVER_AFTER_MS) {
      const hours = Math.floor(sinceEnrollMs / 3_600_000);
      conditions.push({
        key: "heartbeat_never",
        severity: "high",
        title: "PVS-Agent hat sich nach der Einrichtung nie gemeldet",
        body:
          `Der Agent wurde vor rund ${hours} Stunden eingerichtet, hat aber ` +
          "bis jetzt keine einzige Meldung geschickt. Entweder wurde die " +
          "Installation nicht abgeschlossen, der Dienst startet nicht, oder der " +
          "Praxis-Rechner erreicht das Portal nicht.",
        actionSteps: [
          "Prüfen, ob der EINS-Agent-Dienst auf dem Praxis-Rechner installiert ist und läuft.",
          "Im Agent-Log nach Verbindungsfehlern zum Portal suchen (Firewall, Proxy).",
          "Falls nötig, einen neuen Einrichtungs-Link erzeugen und den Agent neu einrichten.",
        ],
        metric: "pvs_agent_hours_since_enrollment",
        observedValue: hours,
      });
    }
    return conditions;
  }

  const heartbeatAgeMs = input.now.getTime() - input.lastHeartbeatAt.getTime();

  // A Praxis PC that is switched off at night is normal. Inside Berlin working
  // hours five silent minutes is an incident (high); outside them only a gap
  // longer than 14 h is worth a (low) notice. Consequence: an alert raised in
  // the day clears at the first evening scan, and is raised again the next
  // working morning if the agent is still silent.
  const inBusinessHours = isBerlinBusinessHours(input.now);
  const staleAfterMs = inBusinessHours
    ? HEARTBEAT_STALE_MS
    : HEARTBEAT_STALE_OFF_HOURS_MS;

  if (heartbeatAgeMs > staleAfterMs) {
    const minutes = Math.floor(heartbeatAgeMs / 60_000);
    conditions.push({
      key: "heartbeat_stale",
      severity: inBusinessHours ? "high" : "warn",
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

    // Operator mail for HIGH conditions. Rate-limited per (clinic, condition)
    // inside notifyOps, never throws, so it cannot fail the reconcile.
    for (const c of conditions) {
      if (c.severity !== "high") continue;
      await notifyOps({
        clinicId,
        kind: dedupeKey(c.key),
        severity: "high",
        title: c.title,
        body: c.body,
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
  "agent_clock_skew",
] as const;

/** Condition keys owned by the hourly liveness scan. */
export const LIVENESS_SCOPE_KEYS = [
  "heartbeat_stale",
  "silent_stall",
  "heartbeat_never",
] as const;

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
    // The reason is rendered in the backlog alert, so a change must refresh it.
    // Only while a backlog exists: otherwise a changing reason would rewrite
    // nothing and force a pointless reconcile.
    hb.stalePendingEvents > 0 ? (hb.uploadReason ?? "") : "",
    [...hb.missingFolders].sort().join("|"),
    hb.dbAdaptersFailed ?? "",
    streams,
    skewBucket(hb.clockSkewSeconds),
  ].join("§");
}

/** "ok" inside the threshold, else direction + order of magnitude of minutes. */
function skewBucket(seconds: number | null | undefined): string {
  // Unknown skew raises no condition, so it is the same state as "within range".
  if (seconds === undefined || seconds === null) return "ok";
  if (Math.abs(seconds) <= CLOCK_SKEW_THRESHOLD_SECONDS) return "ok";
  const minutes = Math.abs(seconds) / 60;
  return `${seconds > 0 ? "+" : "-"}${magnitudeBucket(minutes)}`;
}

/** 0, then one bucket per power of ten. */
function magnitudeBucket(n: number): string {
  if (n <= 0) return "0";
  return `1e${Math.floor(Math.log10(n))}`;
}
