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
} from "@eins/ui";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { AdminPageHeader } from "../_components/AdminPageHeader";

export const metadata = { title: "PVS-Bridge Health" };

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
}

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
          AND u.status IN ('pending','processing'))           AS pending_csv_uploads
    FROM pvs_link l
    LEFT JOIN pvs_sync_status s ON s.pvs_link_id = l.id
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
  }>).map((r) => ({
    id: r.id,
    clinicId: r.clinic_id,
    vendor: r.pvs_vendor,
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
  }));

  const totalConnected = linkRows.filter((r) => r.status === "connected").length;
  const totalErrored = linkRows.filter((r) => r.status === "error").length;
  const totalAkkreditierung = linkRows.filter(
    (r) => r.status === "akkreditierung"
  ).length;

  return (
    <div className="space-y-8">
      <AdminPageHeader
        title="PVS-Bridge Health"
        subtitle="Operational view of every clinic's PVS connection. Read-only."
        actions={
          <Button asChild variant="ghost">
            <Link href="/admin/pvs-bridge/events">Event-Trace öffnen →</Link>
          </Button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <SummaryStat label="Verbunden" value={totalConnected} tone="good" />
        <SummaryStat label="Fehler" value={totalErrored} tone={totalErrored > 0 ? "bad" : "neutral"} />
        <SummaryStat
          label="Akkreditierung"
          value={totalAkkreditierung}
          tone={totalAkkreditierung > 0 ? "warn" : "neutral"}
        />
        <SummaryStat label="Praxen gesamt" value={linkRows.length} tone="neutral" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-Praxis</CardTitle>
          <CardDescription>
            Sortiert nach letztem Event. Klick auf die Praxis-ID startet eine
            Impersonations-Session.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead className="bg-muted/30 text-left uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Praxis</th>
                <th className="p-2">Adapter</th>
                <th className="p-2">Status</th>
                <th className="p-2">Letztes Event</th>
                <th className="p-2 text-right">24h</th>
                <th className="p-2 text-right">Gesamt</th>
                <th className="p-2 text-right">Failures</th>
                <th className="p-2">Letzter Fehler</th>
                <th className="p-2 text-right">Inbox</th>
                <th className="p-2 text-right">CSV</th>
              </tr>
            </thead>
            <tbody>
              {linkRows.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2">
                    <code>{r.clinicId.slice(0, 8)}</code>
                  </td>
                  <td className="p-2">{r.vendor}</td>
                  <td className="p-2">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="p-2 text-muted-foreground">
                    {r.lastEventAt ? formatRelative(r.lastEventAt) : "—"}
                  </td>
                  <td className="p-2 text-right">{r.events24h}</td>
                  <td className="p-2 text-right">{r.totalEvents.toLocaleString("de-DE")}</td>
                  <td className="p-2 text-right">
                    {r.consecutiveFailures > 0 ? (
                      <span className="text-destructive">{r.consecutiveFailures}</span>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="p-2 max-w-xs truncate" title={r.lastError ?? ""}>
                    {r.lastError ? (
                      <span title={formatDateTime(r.lastErrorAt ?? new Date())}>
                        {r.lastError}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {r.openFailures > 0 ? (
                      <Badge tone="warn" className="text-[10px]">
                        {r.openFailures}
                      </Badge>
                    ) : (
                      "0"
                    )}
                  </td>
                  <td className="p-2 text-right">
                    {r.pendingCsvUploads > 0 ? (
                      <Badge tone="warn" className="text-[10px]">
                        {r.pendingCsvUploads}
                      </Badge>
                    ) : (
                      "0"
                    )}
                  </td>
                </tr>
              ))}
              {linkRows.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-4 text-center text-muted-foreground">
                    Noch keine Praxis hat ein pvs_link eingerichtet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div
          className={
            "mt-1 text-2xl font-semibold " +
            (tone === "good"
              ? "text-emerald-600"
              : tone === "warn"
              ? "text-amber-600"
              : tone === "bad"
              ? "text-destructive"
              : "")
          }
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
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
