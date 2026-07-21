import { requireAdmin } from "@/auth/admin-guards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@eins/ui";
import { AdminPageHeader } from "../../_components/AdminPageHeader";
import {
  BRIDGE_SOURCES,
  EVENT_KINDS,
  EVENTS_HARD_CAP,
  listClinicsForFilter,
  listEvents,
  listOpenDriftReports,
  type BridgeSourceValue,
  type EventKind,
} from "@/server/queries/admin-pvs-events";
import { formatDateTime } from "@/lib/formatting";
import { EventsFilters } from "./_components/EventsFilters";
import { EventsPanel } from "./_components/EventsPanel";

export const metadata = { title: "PVS-Bridge Event-Trace" };

/**
 * /admin/pvs-bridge/events — operator timeline.
 *
 * Tab 1 "Event-Trace": filterable, virtualised pvs_event_log view with a
 * per-row detail dialog and a Replay action. The status column is
 * informational only (every persisted row is 'ingested' — see
 * docstring on listEvents).
 *
 * Tab 2 "Schema Drift": open pvs_link_health rows where event_kind =
 * 'schema_drift'. Drift reports are pushed by the on-prem bridge agent
 * via /api/pvs/health and stored alongside auth_expired / connection_lost
 * signals; this tab filters down to the schema cases.
 *
 * URL contract:
 *   ?tab=events|drift
 *   ?clinic=<uuid>
 *   ?source=<bridge_source>
 *   ?kind=<canonical_event_kind>
 *   ?range=1h|24h|7d|custom
 *   ?from=<iso datetime>          (only when range=custom)
 *   ?to=<iso datetime>            (only when range=custom)
 */
export default async function PvsEventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();

  const resolvedParams = await searchParams;
  const filters = resolveFilters(resolvedParams);
  const activeTab = pickOne(resolvedParams.tab) === "drift" ? "drift" : "events";

  const [events, drift, clinics] = await Promise.all([
    listEvents(filters.query),
    listOpenDriftReports(),
    listClinicsForFilter(),
  ]);

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="PVS-Bridge Event-Trace"
        subtitle="Welche Nachricht ging wann ein, was war drin, wo wurde sie hingerouted."
      />

      <Tabs defaultValue={activeTab}>
        <TabsList>
          <TabsTrigger value="events">Event-Trace</TabsTrigger>
          <TabsTrigger value="drift">
            Schema Drift
            {drift.length > 0 ? ` (${drift.length})` : ""}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Filter</CardTitle>
              <CardDescription>
                Defaults: letzte 24 Stunden, alle Praxen. Filter sind URL-
                kodiert; Permalink kopieren funktioniert.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EventsFilters
                clinics={clinics}
                bridgeSources={[...BRIDGE_SOURCES]}
                eventKinds={[...EVENT_KINDS]}
                applied={filters.applied}
              />
            </CardContent>
          </Card>

          <EventsPanel
            rows={events.rows.map((r) => ({
              id: r.id,
              clinicId: r.clinicId,
              clinicLabel: r.clinicDisplayName ?? r.clinicId.slice(0, 8),
              bridgeSource: r.bridgeSource,
              kind: r.kind,
              pvsExternalEventId: r.pvsExternalEventId,
              occurredAt: r.occurredAt.toISOString(),
              receivedAt: r.receivedAt.toISOString(),
            }))}
            truncated={events.truncated}
            hardCap={EVENTS_HARD_CAP}
          />

          <p className="text-xs text-fg-tertiary">
            Hinweis: <code>pvs_event_log</code> enthält nur erfolgreich
            ingestete Events. Deduplikate werden vom UNIQUE-Index am
            DB-Layer verworfen; Errored Events (Signaturfehler, vendor_
            mismatch, link_not_ready) landen in den Bridge-Agent-Logs
            und ggf. in <code>pvs_link_health</code>. Ein eigener Sink
            für Fehlversuche existiert heute nicht.
          </p>
        </TabsContent>

        <TabsContent value="drift" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Offene Schema-Drift-Reports
              </CardTitle>
              <CardDescription>
                Gepusht vom On-Prem-Bridge-Agent (SQL-Introspection-
                Framework). Behoben werden sie durch ein Vendor-Config-
                Update plus Re-Snapshot, oder durch manuelles{" "}
                <code>resolved_at</code>-Setzen in der DB.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-xs">
                <thead className="border-b border-border bg-bg-secondary text-left font-medium text-fg-secondary">
                  <tr>
                    <th className="p-2">Erkannt</th>
                    <th className="p-2">Praxis</th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2">Stream</th>
                    <th className="p-2">Severity</th>
                    <th className="p-2">Beschreibung</th>
                    <th className="p-2">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {drift.map((d) => (
                    <tr key={d.id} className="border-t border-border">
                      <td className="p-2 whitespace-nowrap text-fg-secondary">
                        {formatDateTime(d.detectedAt)}
                      </td>
                      <td className="p-2">
                        <code>{d.clinicId.slice(0, 8)}</code>
                        {d.clinicDisplayName ? (
                          <span className="ml-2 text-fg-secondary">
                            {d.clinicDisplayName}
                          </span>
                        ) : null}
                      </td>
                      <td className="p-2">{d.pvsVendor}</td>
                      <td className="p-2">{d.streamKind}</td>
                      <td className="p-2">{d.severity}</td>
                      <td className="p-2 max-w-md truncate" title={d.message}>
                        {d.message}
                      </td>
                      <td className="p-2">
                        <details>
                          <summary className="cursor-pointer text-fg-tertiary hover:text-fg-primary">
                            anzeigen
                          </summary>
                          <pre className="mt-2 max-w-md overflow-x-auto rounded bg-bg-secondary p-2 text-[11px]">
                            {JSON.stringify(d.detail, null, 2)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                  {drift.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="px-4 py-10 text-center text-fg-secondary"
                      >
                        Keine offenen Drift-Reports.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

interface ResolvedFilters {
  query: {
    clinicId?: string;
    bridgeSource?: BridgeSourceValue;
    kind?: EventKind;
    from: Date;
    to: Date;
  };
  applied: {
    clinicId: string;
    bridgeSource: string;
    kind: string;
    range: string;
    from: string;
    to: string;
  };
}

function resolveFilters(
  searchParams: Record<string, string | string[] | undefined>
): ResolvedFilters {
  const range = pickOne(searchParams.range) ?? "24h";
  const now = new Date();
  let from: Date;
  let to: Date = now;
  const fromParam = pickOne(searchParams.from);
  const toParam = pickOne(searchParams.to);

  if (range === "custom" && fromParam && toParam) {
    const f = new Date(fromParam);
    const t = new Date(toParam);
    from = Number.isNaN(f.getTime()) ? defaultFrom(range, now) : f;
    to = Number.isNaN(t.getTime()) ? now : t;
  } else {
    from = defaultFrom(range, now);
  }

  const clinicId = pickOne(searchParams.clinic);
  const sourceRaw = pickOne(searchParams.source);
  const kindRaw = pickOne(searchParams.kind);

  const bridgeSource = (BRIDGE_SOURCES as readonly string[]).includes(
    sourceRaw ?? ""
  )
    ? (sourceRaw as BridgeSourceValue)
    : undefined;
  const kind = (EVENT_KINDS as readonly string[]).includes(kindRaw ?? "")
    ? (kindRaw as EventKind)
    : undefined;

  return {
    query: {
      clinicId: clinicId && isUuid(clinicId) ? clinicId : undefined,
      bridgeSource,
      kind,
      from,
      to,
    },
    applied: {
      clinicId: clinicId ?? "",
      bridgeSource: bridgeSource ?? "",
      kind: kind ?? "",
      range,
      from: fromParam ?? "",
      to: toParam ?? "",
    },
  };
}

function defaultFrom(range: string, now: Date): Date {
  const ms = range === "1h" ? 60 * 60 * 1000
    : range === "7d" ? 7 * 24 * 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return new Date(now.getTime() - ms);
}

function pickOne(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    s
  );
}
