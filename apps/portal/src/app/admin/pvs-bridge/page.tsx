import Link from "next/link";
import { sql } from "drizzle-orm";
import { requireAdmin } from "@/auth/admin-guards";
import { db, schema } from "@/db/client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Badge,
  Button,
  MetricTile,
} from "@eins/ui";
import { formatDateTime, formatNumber, formatRelative } from "@/lib/formatting";
import { AdminPageHeader } from "../_components/AdminPageHeader";
import { AdminTable, type AdminColumn } from "../_components/AdminTable";

export const metadata = { title: "PVS-Bridge" };

/**
 * /admin/pvs-bridge — operational health dashboard.
 *
 * For each connected `pvs_link`, show:
 *   • vendor + status + last event ago
 *   • last_incremental_at + consecutive failures + last error
 *   • events ingested 24h
 *   • CSV upload backlog
 *   • linking-failures open count
 *
 * Karam-only access (requireAdmin). Read-only — interventions happen
 * via the clinic-side UI or psql.
 */

interface LinkRow {
  id: string;
  clinicId: string;
  vendor: string;
  /** Phase 7: the full set of bridge_sources the clinic may emit
   *  (pvs_link_source). The vendor above is the primary; this can be a
   *  superset for a GDT agent reading several PVS engines. */
  sources: string[];
  status: string;
  lastEventAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: Date | null;
  lastIncrementalAt: Date | null;
  events24h: number;
  totalEvents: number;
  openFailures: number;
  pendingCsvUploads: number;
  agentFailedEvents: number;
  agentLastHeartbeatAt: Date | null;
}

const AGENT_FAILED_ALERT_THRESHOLD = 100;

export default async function AdminPvsBridgePage() {
  await requireAdmin();

  const rows = await db.execute<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    last_event_at: Date | null;
    consecutive_failure_count: number;
    last_error: string | null;
    last_error_at: Date | null;
    last_incremental_at: Date | null;
    total_events_last_24h: number;
    total_events_ingested: number;
    open_failures: number;
    pending_csv_uploads: number;
    agent_failed_events: number | null;
    agent_last_heartbeat_at: Date | null;
    sources: string | null;
  }>(sql`
    SELECT
      l.id,
      l.clinic_id,
      l.pvs_vendor,
      l.status,
      l.last_event_at,
      COALESCE(s.consecutive_failure_count, 0)  AS consecutive_failure_count,
      s.last_error,
      s.last_error_at,
      s.last_incremental_at,
      COALESCE(s.total_events_last_24h, 0)      AS total_events_last_24h,
      COALESCE(s.total_events_ingested, 0)      AS total_events_ingested,
      (SELECT COUNT(*) FROM linking_failures f
        WHERE f.clinic_id = l.clinic_id AND f.status = 'open') AS open_failures,
      (SELECT COUNT(*) FROM pvs_csv_uploads u
        WHERE u.clinic_id = l.clinic_id
          AND u.status IN ('pending','processing'))           AS pending_csv_uploads,
      a.failed_events                                          AS agent_failed_events,
      a.last_heartbeat_at                                      AS agent_last_heartbeat_at,
      (SELECT string_agg(DISTINCT src.bridge_source, ',' ORDER BY src.bridge_source)
         FROM pvs_link_source src
        WHERE src.clinic_id = l.clinic_id)                    AS sources
    FROM pvs_link l
    LEFT JOIN pvs_sync_status s ON s.pvs_link_id = l.id
    LEFT JOIN pvs_agent_status a ON a.clinic_id = l.clinic_id
    ORDER BY l.last_event_at DESC NULLS LAST
  `);

  const linkRows: LinkRow[] = (rows as unknown as Array<{
    id: string;
    clinic_id: string;
    pvs_vendor: string;
    status: string;
    last_event_at: Date | null;
    consecutive_failure_count: number;
    last_error: string | null;
    last_error_at: Date | null;
    last_incremental_at: Date | null;
    total_events_last_24h: number;
    total_events_ingested: number;
    open_failures: number;
    pending_csv_uploads: number;
    agent_failed_events: number | null;
    agent_last_heartbeat_at: Date | null;
    sources: string | null;
  }>).map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    vendor: r.pvs_vendor,
    sources: r.sources ? r.sources.split(",") : [],
    status: r.status,
    lastEventAt: r.last_event_at,
    consecutiveFailures: Number(r.consecutive_failure_count) || 0,
    lastError: r.last_error,
    lastErrorAt: r.last_error_at,
    lastIncrementalAt: r.last_incremental_at,
    events24h: Number(r.total_events_last_24h) || 0,
    totalEvents: Number(r.total_events_ingested) || 0,
    openFailures: Number(r.open_failures) || 0,
    pendingCsvUploads: Number(r.pending_csv_uploads) || 0,
    agentFailedEvents: Number(r.agent_failed_events) || 0,
    agentLastHeartbeatAt: r.agent_last_heartbeat_at,
  }));

  const agentAlertCount = linkRows.filter(
    (r) => r.agentFailedEvents > AGENT_FAILED_ALERT_THRESHOLD
  ).length;

  const totalConnected = linkRows.filter((r) => r.status === "connected").length;
  const totalErrored = linkRows.filter((r) => r.status === "error").length;
  const totalAkkreditierung = linkRows.filter(
    (r) => r.status === "akkreditierung"
  ).length;

  const columns: AdminColumn<LinkRow>[] = [
    {
      key: "praxis",
      header: "Praxis",
      render: (r) => (
        <span className="font-mono text-xs">{r.clinicId.slice(0, 8)}</span>
      ),
    },
    {
      key: "adapter",
      header: "Adapter",
      render: (r) => formatAdapter(r.vendor, r.sources),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "lastEvent",
      header: "Letztes Event",
      render: (r) => (
        <span className="text-fg-secondary">
          {r.lastEventAt ? formatRelative(r.lastEventAt) : "–"}
        </span>
      ),
    },
    {
      key: "events24h",
      header: "Events (24h)",
      align: "right",
      render: (r) => formatNumber(r.events24h),
    },
    {
      key: "failures",
      header: "Fehler in Folge",
      align: "right",
      render: (r) =>
        r.consecutiveFailures > 0 ? (
          <span className="text-tone-bad">{r.consecutiveFailures}</span>
        ) : (
          "0"
        ),
    },
    {
      key: "dlq",
      header: "Agent-DLQ",
      align: "right",
      render: (r) =>
        r.agentLastHeartbeatAt === null ? (
          <span className="text-fg-secondary">–</span>
        ) : r.agentFailedEvents > 0 ? (
          <Badge
            tone={
              r.agentFailedEvents > AGENT_FAILED_ALERT_THRESHOLD ? "bad" : "warn"
            }
            className="text-[10px]"
          >
            {r.agentFailedEvents}
          </Badge>
        ) : (
          "0"
        ),
    },
    {
      key: "totalEvents",
      header: "Gesamt",
      detailLabel: "Events gesamt",
      align: "right",
      secondary: true,
      render: (r) => formatNumber(r.totalEvents),
    },
    {
      key: "lastError",
      header: "Letzter Fehler",
      secondary: true,
      render: (r) =>
        r.lastError ? (
          <span title={formatDateTime(r.lastErrorAt ?? new Date())}>
            {r.lastError}
          </span>
        ) : (
          "–"
        ),
    },
    {
      key: "openFailures",
      header: "Offene Zuordnungen",
      align: "right",
      secondary: true,
      render: (r) =>
        r.openFailures > 0 ? (
          <Badge tone="warn" className="text-[10px]">
            {r.openFailures}
          </Badge>
        ) : (
          "0"
        ),
    },
    {
      key: "csv",
      header: "CSV-Uploads",
      align: "right",
      secondary: true,
      render: (r) =>
        r.pendingCsvUploads > 0 ? (
          <Badge tone="warn" className="text-[10px]">
            {r.pendingCsvUploads}
          </Badge>
        ) : (
          "0"
        ),
    },
  ];

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="PVS-Bridge"
        subtitle="Betriebszustand jeder PVS-Verbindung, pro Praxis. Nur Lesezugriff."
        actions={
          <Button asChild variant="ghost">
            <Link href="/admin/pvs-bridge/events">Event-Trace öffnen →</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricTile
          label="Verbunden"
          value={formatNumber(totalConnected)}
          tone="good"
        />
        <MetricTile
          label="Fehler"
          value={formatNumber(totalErrored)}
          tone={totalErrored > 0 ? "bad" : "neutral"}
        />
        <MetricTile
          label="Akkreditierung"
          value={formatNumber(totalAkkreditierung)}
          tone={totalAkkreditierung > 0 ? "warn" : "neutral"}
        />
        <MetricTile
          label="Agent-DLQ über 100"
          value={formatNumber(agentAlertCount)}
          tone={agentAlertCount > 0 ? "bad" : "neutral"}
        />
        <MetricTile label="Praxen gesamt" value={formatNumber(linkRows.length)} />
      </div>

      <Card className="!p-0 overflow-hidden">
        <CardHeader className="px-6 pt-6">
          <CardTitle className="!text-xl !font-medium md:!text-2xl">
            Per-Praxis
          </CardTitle>
          <CardDescription>
            Sortiert nach letztem Event. Details je Zeile über die
            Detail-Ansicht.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <AdminTable
            columns={columns}
            rows={linkRows}
            getRowKey={(r) => r.id}
            empty="Noch keine Praxis hat eine PVS-Verbindung eingerichtet."
          />
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Render the clinic's adapter set: the primary vendor, then any additional
 * enrolled bridge_sources as `+source` (e.g. a GDT agent that also reads
 * medatixx shows `gdt_agent +medatixx`). Falls back to the bare vendor when
 * pvs_link_source has nothing beyond it.
 */
function formatAdapter(vendor: string, sources: string[]): string {
  const extras = sources.filter((s) => s !== vendor);
  return extras.length > 0
    ? `${vendor} ${extras.map((e) => `+${e}`).join(" ")}`
    : vendor;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; tone: "good" | "warn" | "bad" | "neutral" }> = {
    connected: { label: "Verbunden", tone: "good" },
    pending: { label: "Wartet", tone: "warn" },
    akkreditierung: { label: "Akkreditierung", tone: "warn" },
    error: { label: "Fehler", tone: "bad" },
    disconnected: { label: "Getrennt", tone: "neutral" },
    unconfigured: { label: "Nicht konfiguriert", tone: "neutral" },
  };
  const info = map[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={info.tone}>{info.label}</Badge>;
}
