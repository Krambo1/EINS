import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
} from "@eins/ui";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import type { schema } from "@/db/client";
import { Brand } from "@/app/_components/Brand";

type Cred = typeof schema.platformCredentials.$inferSelect;
interface SyncEvent {
  id: string;
  createdAt: Date;
  diff: unknown;
  action: string;
}

export interface AdsConversionHealth {
  pending: number;
  sent: number;
  skipped: number;
  failed: number;
  recent: Array<{
    id: string;
    channel: string;
    status: string;
    valueEur: string;
    createdAt: Date;
    sentAt: Date | null;
    responseCode: number | null;
    responseBody: unknown;
  }>;
}

/**
 * P2-2: agent heartbeat surface. Populated from pvs_agent_status; the
 * "recent reasons" expander reads the JSONB column directly. Null when
 * the agent has never sent a heartbeat (e.g. clinic without an on-prem
 * install — cloud adapters don't produce this signal).
 */
/** Ein Eintrag aus pvs_agent_status.adapter_statuses (0069). */
export interface AdapterStatusEntry {
  vendor: string;
  stream: string;
  status: string;
  lastError?: string | null;
  connectError?: string | null;
}

/** Diese Zustände bedeuten: aus diesem Stream fließt nichts mehr. */
const UNHEALTHY_ADAPTER_STATUS = new Set([
  "error",
  "schema_drift",
  "config_invalid",
]);

const ADAPTER_STATUS_LABEL: Record<string, string> = {
  idle: "Bereit",
  running: "Läuft",
  error: "Fehler",
  schema_drift: "Schema geändert",
  config_invalid: "Konfiguration ungültig",
  disabled: "Deaktiviert",
};

function isAdapterUnhealthy(a: AdapterStatusEntry): boolean {
  return UNHEALTHY_ADAPTER_STATUS.has(a.status) || Boolean(a.connectError);
}

export interface AgentStatusHealth {
  lastHeartbeatAt: Date;
  agentVersion: string | null;
  failedEvents: number;
  oldestFailedAt: Date | null;
  lastFailureReason: string | null;
  recentReasons: Array<{ reason: string; count: number }>;
  /**
   * 0069: liveness signals next to the dead-letter counter. Ein Backlog, das
   * ewig neu versucht wird, ein verschobener Export-Ordner und ein nie
   * gestarteter Runner melden alle failedEvents = 0.
   */
  pendingEvents: number;
  /** Teilmenge von pendingEvents, die älter als 1 h ist: Backlog steckt. */
  stalePendingEvents: number;
  oldestPendingAt: Date | null;
  /** Konfigurierte Watch-Ordner, die der Agent nicht finden kann. */
  missingFolders: string[];
  /** Nicht null, wenn der DB-Adapter-Runner gar nicht erst gestartet ist. */
  dbAdaptersFailed: string | null;
  adapterStatuses: AdapterStatusEntry[];
  /** Latest 5 prune roll-ups (most recent first). */
  recentPruneSummaries: Array<{
    id: string;
    prunedCount: number;
    prunedOldestAt: Date | null;
    prunedNewestAt: Date | null;
    topReason: string | null;
    reportedAt: Date;
  }>;
}

const ALERT_FAILED_THRESHOLD = 100;

export function IntegrationenTab({
  creds,
  syncHistory,
  adsConversion,
  agentStatus,
}: {
  creds: Cred[];
  syncHistory: SyncEvent[];
  adsConversion: AdsConversionHealth;
  agentStatus: AgentStatusHealth | null;
}) {
  return (
    <div className="space-y-5">
      {agentStatus !== null && <AgentStatusCard status={agentStatus} />}

      <Card>
        <CardHeader>
          <CardTitle>Werbekonten</CardTitle>
          <CardDescription>
            Verbundene Plattformen und letzter Synchronisationsstand.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["meta", "google"] as const).map((p) => {
            const c = creds.find((x) => x.platform === p);
            return (
              <div
                key={p}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-secondary px-4 py-3"
              >
                <div>
                  <div className="font-medium">
                    {p === "meta" ? (
                      <Brand brand="meta">Meta / Instagram</Brand>
                    ) : (
                      <Brand brand="google">Google Ads</Brand>
                    )}
                  </div>
                  <div className="text-xs text-fg-secondary">
                    {c
                      ? `Konto ${c.accountId ?? "?"} · zuletzt ${
                          c.lastSyncedAt ? formatRelative(c.lastSyncedAt) : "nie"
                        }`
                      : "Nicht verbunden"}
                  </div>
                  {c?.lastSyncError && (
                    <div className="mt-1 text-xs text-tone-bad">
                      Fehler: {c.lastSyncError}
                    </div>
                  )}
                </div>
                <div>
                  {c ? (
                    c.lastSyncError ? (
                      <Badge tone="bad">Fehler</Badge>
                    ) : (
                      <Badge tone="good">Verbunden</Badge>
                    )
                  ) : (
                    <Badge tone="neutral">Offen</Badge>
                  )}
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Closed-Loop Conversion-Outbox</CardTitle>
          <CardDescription>
            Pro bezahlte Rechnung wird je ein Meta-CAPI- und ein
            Google-OCI-Upload in die Outbox geschrieben. Hier sind die
            letzten Ereignisse mit Status und Antwort-Code der Plattformen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-4 gap-3 text-xs">
            <OutboxStat label="Gesendet" value={adsConversion.sent} tone="good" />
            <OutboxStat
              label="Wartend"
              value={adsConversion.pending}
              tone="neutral"
            />
            <OutboxStat
              label="Übersprungen"
              value={adsConversion.skipped}
              tone="neutral"
            />
            <OutboxStat
              label="Fehlgeschlagen"
              value={adsConversion.failed}
              tone="bad"
            />
          </div>
          {adsConversion.recent.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Noch keine Conversion-Uploads. Erste bezahlte Rechnung mit
              vorhandenem fbclid oder gclid füllt diese Liste.
            </p>
          ) : (
            <ol className="space-y-1.5 text-xs">
              {adsConversion.recent.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="text-[11px] text-fg-tertiary tabular-nums">
                    {formatDateTime(r.createdAt)}
                  </span>
                  <Badge tone="neutral">{r.channel}</Badge>
                  <Badge tone={outboxTone(r.status)}>{r.status}</Badge>
                  <span className="text-fg-secondary">{r.valueEur} €</span>
                  {r.responseCode !== null && r.responseCode !== 0 && (
                    <span className="text-fg-secondary">
                      HTTP {r.responseCode}
                    </span>
                  )}
                  {(r.status === "skipped" || r.status === "failed") &&
                    !!r.responseBody && (
                      <span className="truncate text-fg-secondary">
                        {summarizeOutboxBody(r.responseBody)}
                      </span>
                    )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sync-Historie</CardTitle>
          <CardDescription>
            Audit-Spuren rund um Synchronisations-Ereignisse. Leer, bis ein
            Fehler oder eine Anpassung auftritt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {syncHistory.length === 0 ? (
            <p className="text-sm text-fg-secondary">
              Keine Sync-Ereignisse aufgezeichnet.
            </p>
          ) : (
            <ol className="space-y-2 text-sm">
              {syncHistory.map((e) => (
                <li
                  key={e.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="text-[11px] text-fg-tertiary tabular-nums">
                    {formatDateTime(e.createdAt)}
                  </span>
                  <Badge tone="neutral">{e.action}</Badge>
                  {!!e.diff && (
                    <span className="text-xs text-fg-secondary">
                      {summarizeDiff(e.diff)}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function summarizeDiff(diff: unknown): string {
  if (!diff || typeof diff !== "object") return "";
  const d = diff as Record<string, unknown>;
  if (typeof d.error === "string") return d.error.slice(0, 120);
  if (typeof d.platform === "string") return `Plattform: ${d.platform}`;
  return Object.keys(d).slice(0, 3).join(", ");
}

function OutboxStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "neutral" | "bad";
}) {
  return (
    <div className="rounded-md border border-border bg-bg-secondary px-2.5 py-2">
      <div className="text-fg-secondary">{label}</div>
      <div
        className={
          tone === "good"
            ? "text-tone-good"
            : tone === "bad"
              ? "text-tone-bad"
              : "text-fg-primary"
        }
      >
        <span className="text-lg font-semibold">{value}</span>
      </div>
    </div>
  );
}

function outboxTone(status: string): "good" | "neutral" | "warn" | "bad" {
  switch (status) {
    case "sent":
      return "good";
    case "failed":
      return "bad";
    case "skipped":
      return "neutral";
    default:
      return "warn";
  }
}

function AgentStatusCard({ status }: { status: AgentStatusHealth }) {
  // OutboxStat tone is good|neutral|bad — no separate "warn" bucket, so
  // we map "some failures but under the alert threshold" to "neutral"
  // and reserve "bad" for the alert threshold.
  const failedTone: "good" | "neutral" | "bad" =
    status.failedEvents >= ALERT_FAILED_THRESHOLD
      ? "bad"
      : status.failedEvents > 0
        ? "neutral"
        : "good";
  // The heartbeat producer cadence is 60s. If the last heartbeat is
  // older than 5 min, the agent is either offline or its Praxis-network
  // is down — the operator should be alerted.
  const heartbeatStale =
    Date.now() - status.lastHeartbeatAt.getTime() > 5 * 60 * 1000;
  // 0069: das Wartende-Backlog. Alles unter 1 h ist normaler Durchlauf
  // (neutral), alles darüber steckt fest und muss angefasst werden (bad).
  const pendingTone: "good" | "neutral" | "bad" =
    status.stalePendingEvents > 0
      ? "bad"
      : status.pendingEvents > 0
        ? "neutral"
        : "good";
  const unhealthyAdapters = status.adapterStatuses.filter(isAdapterUnhealthy);
  const hasUnhealthyAdapters = unhealthyAdapters.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>GDT-Agent · Status</CardTitle>
        <CardDescription>
          Heartbeat alle 60 s vom On-Prem-Agent. Zeigt das Backlog an
          dauerhaft fehlgeschlagenen Outbox-Zeilen (Dead-Letter) und die
          häufigsten Fehlergründe. Beim Überschreiten von {ALERT_FAILED_THRESHOLD}{" "}
          Zeilen wird die Praxis auf dem Admin-Dashboard hervorgehoben. Daneben
          stehen die Liveness-Signale: wartendes Backlog, fehlende
          Export-Ordner und der Zustand der einzelnen Streams. Damit lässt sich
          eine ruhige Woche von einer kaputten Installation unterscheiden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
          <OutboxStat
            label="Dead-Letter"
            value={status.failedEvents}
            tone={failedTone}
          />
          <OutboxStat
            label="Wartend"
            value={status.pendingEvents}
            tone={pendingTone}
          />
          <div className="rounded-md border border-border bg-bg-secondary px-2.5 py-2">
            <div className="text-fg-secondary">Letzter Heartbeat</div>
            <div className={heartbeatStale ? "text-tone-bad" : "text-fg-primary"}>
              <span className="text-sm font-semibold">
                {formatRelative(status.lastHeartbeatAt)}
              </span>
              <div className="text-[10px] text-fg-tertiary">
                v{status.agentVersion ?? "–"}
              </div>
            </div>
          </div>
          <div className="rounded-md border border-border bg-bg-secondary px-2.5 py-2">
            <div className="text-fg-secondary">Ältester Fehler</div>
            <div className="text-fg-primary">
              <span className="text-sm font-semibold">
                {status.oldestFailedAt
                  ? formatRelative(status.oldestFailedAt)
                  : "–"}
              </span>
            </div>
          </div>
        </div>
        {status.stalePendingEvents > 0 && (
          <div className="rounded-md border border-tone-bad bg-bg-secondary px-3 py-2 text-xs">
            <div className="font-semibold text-tone-bad">
              Backlog steckt fest
            </div>
            <div className="mt-0.5 text-fg-primary">
              {status.stalePendingEvents} von {status.pendingEvents} wartenden
              Zeilen liegen seit über einer Stunde in der Outbox. Der Agent
              sendet, die Zeilen kommen aber nicht an.
              {status.oldestPendingAt && (
                <> Ältester Eintrag: {formatRelative(status.oldestPendingAt)}.</>
              )}
            </div>
          </div>
        )}
        {status.missingFolders.length > 0 && (
          <div className="rounded-md border border-tone-bad bg-bg-secondary px-3 py-2 text-xs">
            <div className="font-semibold text-tone-bad">
              Export-Ordner nicht gefunden
            </div>
            <div className="mt-0.5 text-fg-primary">
              Der Agent findet {status.missingFolders.length} konfigurierte{" "}
              {status.missingFolders.length === 1 ? "Ablage" : "Ablagen"} nicht.
              Aus {status.missingFolders.length === 1 ? "ihr" : "ihnen"} kann
              nichts eingelesen werden, solange der Pfad falsch ist.
            </div>
            <ul className="mt-1.5 space-y-1">
              {status.missingFolders.map((f) => (
                <li
                  key={f}
                  className="truncate border-l-2 border-border pl-3 font-mono text-fg-primary"
                  title={f}
                >
                  {f}
                </li>
              ))}
            </ul>
          </div>
        )}
        {status.dbAdaptersFailed && (
          <div className="rounded-md border border-tone-bad bg-bg-secondary px-3 py-2 text-xs">
            <div className="font-semibold text-tone-bad">
              DB-Adapter nicht gestartet
            </div>
            <div className="mt-0.5 text-fg-primary">
              Kein einziger Datenbank-Stream läuft. Aus dem PVS kommen deshalb
              keine Umsätze an.
            </div>
            <div
              className="mt-1.5 truncate border-l-2 border-border pl-3 font-mono text-fg-primary"
              title={status.dbAdaptersFailed}
            >
              {status.dbAdaptersFailed}
            </div>
          </div>
        )}
        {status.adapterStatuses.length > 0 &&
          (hasUnhealthyAdapters ? (
            <div className="rounded-md border border-tone-bad bg-bg-secondary px-3 py-2 text-xs">
              <div className="font-semibold text-tone-bad">
                {unhealthyAdapters.length} von {status.adapterStatuses.length}{" "}
                Streams liefern nichts
              </div>
              <ul className="mt-1.5 space-y-1.5">
                {status.adapterStatuses.map((a) => (
                  <AdapterStatusRow key={`${a.vendor}:${a.stream}`} adapter={a} />
                ))}
              </ul>
            </div>
          ) : (
            <details className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs">
              <summary className="cursor-pointer text-fg-secondary">
                Alle {status.adapterStatuses.length} Streams laufen
              </summary>
              <ul className="mt-2 space-y-1.5">
                {status.adapterStatuses.map((a) => (
                  <AdapterStatusRow key={`${a.vendor}:${a.stream}`} adapter={a} />
                ))}
              </ul>
            </details>
          ))}
        {status.lastFailureReason && (
          <div className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs">
            <div className="text-fg-secondary">Letzter Grund</div>
            <div className="mt-0.5 truncate font-mono text-fg-primary" title={status.lastFailureReason}>
              {status.lastFailureReason}
            </div>
          </div>
        )}
        {status.recentReasons.length > 0 && (
          <details className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs">
            <summary className="cursor-pointer text-fg-secondary">
              Letzte {Math.min(10, status.recentReasons.length)} Fehlergründe
              anzeigen
            </summary>
            <ol className="mt-2 space-y-1">
              {status.recentReasons.slice(0, 10).map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 border-l-2 border-border pl-3">
                  <Badge tone="neutral" className="font-mono text-[10px]">
                    ×{r.count}
                  </Badge>
                  <span className="truncate font-mono text-fg-primary" title={r.reason}>
                    {r.reason}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
        {status.recentPruneSummaries.length > 0 && (
          <details className="rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs">
            <summary className="cursor-pointer text-fg-secondary">
              Dead-Letter-Prune-Historie ({status.recentPruneSummaries.length})
            </summary>
            <ol className="mt-2 space-y-1.5">
              {status.recentPruneSummaries.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-baseline gap-2 border-l-2 border-border pl-3"
                >
                  <span className="text-[11px] text-fg-tertiary tabular-nums">
                    {formatDateTime(p.reportedAt)}
                  </span>
                  <Badge tone="warn">{p.prunedCount} gelöscht</Badge>
                  {p.prunedOldestAt && p.prunedNewestAt && (
                    <span className="text-fg-secondary">
                      {formatDateTime(p.prunedOldestAt)} →{" "}
                      {formatDateTime(p.prunedNewestAt)}
                    </span>
                  )}
                  {p.topReason && (
                    <span className="truncate font-mono text-fg-secondary" title={p.topReason}>
                      {p.topReason}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Eine Zeile pro Vendor-Stream. Der Fehlertext steht direkt darunter, damit
 * man beim Überfliegen sieht, warum ein Stream nichts liefert.
 */
function AdapterStatusRow({ adapter }: { adapter: AdapterStatusEntry }) {
  const unhealthy = isAdapterUnhealthy(adapter);
  const detail = adapter.connectError ?? adapter.lastError ?? null;
  return (
    <li className="border-l-2 border-border pl-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-fg-primary">{adapter.vendor}</span>
        <span className="font-mono text-[11px] text-fg-secondary">
          {adapter.stream}
        </span>
        <Badge tone={unhealthy ? "bad" : "good"}>
          {ADAPTER_STATUS_LABEL[adapter.status] ?? adapter.status}
        </Badge>
        {adapter.connectError && (
          <span className="text-[11px] text-tone-bad">keine Verbindung</span>
        )}
      </div>
      {detail && (
        <div
          className={`mt-0.5 truncate font-mono text-[11px] ${
            unhealthy ? "text-tone-bad" : "text-fg-secondary"
          }`}
          title={detail}
        >
          {detail}
        </div>
      )}
    </li>
  );
}

function summarizeOutboxBody(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const b = body as Record<string, unknown>;
  if (typeof b.reason === "string") return b.reason;
  if (typeof b.error === "string") return b.error.slice(0, 100);
  const err = b.error as Record<string, unknown> | undefined;
  if (err && typeof err.message === "string") return err.message.slice(0, 100);
  return "";
}
