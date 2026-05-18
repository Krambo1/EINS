import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Badge,
  Separator,
} from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatDateTime, formatRelative } from "@/lib/formatting";
import { Plug, AlertTriangle, Database, FileSpreadsheet, Wand2 } from "lucide-react";

/**
 * /einstellungen/integrationen
 *
 * Overview of the clinic's PVS Bridge state:
 *   • Current pvs_link record (vendor, status, last event).
 *   • Counts of open linking failures + unmapped treatments/locations.
 *   • Links to the per-vendor setup wizard + inbox + mapping pages.
 */

export const metadata = { title: "PVS-Integration" };

const VENDOR_LABELS: Record<string, string> = {
  tomedo: "Tomedo",
  healthhub: "medatixx HealthHub",
  red: "RED interchange",
  gdt_agent: "GDT-Agent",
  csv_upload: "CSV-Upload",
  n8n_custom: "n8n Workflow",
  none: "Nicht verbunden",
};

const STATUS_LABELS: Record<
  string,
  { label: string; tone: "neutral" | "good" | "warn" | "bad" }
> = {
  unconfigured: { label: "Nicht eingerichtet", tone: "neutral" },
  akkreditierung: { label: "Akkreditierung läuft", tone: "warn" },
  pending: { label: "Wartet auf erste Sync", tone: "warn" },
  connected: { label: "Verbunden", tone: "good" },
  error: { label: "Fehler", tone: "bad" },
  disconnected: { label: "Getrennt", tone: "neutral" },
};

export default async function IntegrationenPage() {
  const session = await requireSession();

  const [link] = await db
    .select({
      id: schema.pvsLink.id,
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
      lastEventAt: schema.pvsLink.lastEventAt,
      updatedAt: schema.pvsLink.updatedAt,
    })
    .from(schema.pvsLink)
    .where(eq(schema.pvsLink.clinicId, session.clinicId))
    .limit(1);

  const [openFailures] = await db
    .select({ n: count() })
    .from(schema.linkingFailures)
    .where(
      and(
        eq(schema.linkingFailures.clinicId, session.clinicId),
        eq(schema.linkingFailures.status, "open")
      )
    );
  const openFailureCount = openFailures?.n ?? 0;

  const [unmappedTreatments] = await db
    .select({ n: count() })
    .from(schema.pvsTreatmentMapping)
    .where(
      and(
        eq(schema.pvsTreatmentMapping.clinicId, session.clinicId),
        eq(schema.pvsTreatmentMapping.status, "unmapped")
      )
    );
  const unmappedTreatmentCount = unmappedTreatments?.n ?? 0;

  const [unmappedLocations] = await db
    .select({ n: count() })
    .from(schema.pvsLocationMapping)
    .where(
      and(
        eq(schema.pvsLocationMapping.clinicId, session.clinicId),
        eq(schema.pvsLocationMapping.status, "unmapped")
      )
    );
  const unmappedLocationCount = unmappedLocations?.n ?? 0;

  const vendor = link?.vendor ?? "none";
  const status = link?.status ?? "unconfigured";
  const vendorLabel = VENDOR_LABELS[vendor] ?? vendor;
  const statusInfo = STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">PVS-Integration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verbindung Ihrer Praxis-Software (Tomedo, medatixx, RED, etc.) mit dem
            EINS Portal. Sobald aktiv, leitet das Portal Status (Termin, behandelt,
            gewonnen) und Umsatz aus echten PVS-Daten ab — keine manuellen Einträge mehr.
          </p>
        </div>
      </header>

      {/* Current link state */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Plug className="h-5 w-5" />
              {vendorLabel}
            </CardTitle>
            <CardDescription>
              {link?.lastEventAt
                ? `Letztes Event: ${formatRelative(link.lastEventAt)}`
                : "Noch keine Events empfangen"}
            </CardDescription>
          </div>
          <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Praxis-ID</div>
              <code className="text-xs">{session.clinicId}</code>
            </div>
            <div>
              <div className="text-muted-foreground">Zuletzt aktualisiert</div>
              <div>
                {link?.updatedAt ? formatDateTime(link.updatedAt) : "—"}
              </div>
            </div>
          </div>
          <Separator />
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/einstellungen/integrationen/setup">
                {vendor === "none" ? "Verbindung einrichten" : "Anbieter wechseln"}
              </Link>
            </Button>
            {vendor !== "none" && (
              <Button asChild variant="outline">
                <Link href="/einstellungen/integrationen/setup/csv">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  CSV nachladen
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Operational signals */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" />
              Nicht zuordenbare Patienten
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{openFailureCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              PVS-Events, deren Patient nicht eindeutig einer EINS-Anfrage
              zugeordnet werden konnte.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/einstellungen/integrationen/links">Inbox öffnen</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wand2 className="h-4 w-4" />
              Offene Behandlungs-Mappings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{unmappedTreatmentCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              PVS-Behandlungscodes, die noch keiner EINS-Behandlung zugeordnet sind.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/einstellungen/integrationen/mapping/treatments">
                Mapping öffnen
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4" />
              Offene Standort-Mappings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{unmappedLocationCount}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              PVS-Standorte, die noch keinem EINS-Standort zugeordnet sind.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href="/einstellungen/integrationen/mapping/locations">
                Mapping öffnen
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
