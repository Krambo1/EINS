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
import { listUnresolvedHealth } from "@/server/pvs-health";
import {
  Plug,
  AlertTriangle,
  Database,
  FileSpreadsheet,
  Wand2,
  Target,
  ShieldAlert,
} from "lucide-react";

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
  pabau: "Pabau",
  consentz: "Consentz",
  gdt_agent: "GDT-Agent",
  csv_upload: "CSV-Upload",
  n8n_custom: "n8n Workflow",
  none: "Nicht verbunden",
};

// Health-event labels surfaced in the drift-warning card. Vendor IDs from
// db-adapter YAMLs are matched as prefixes (e.g. "tomedo-db" → "Tomedo
// (Datenbank-Lesepfad)") so the Praxis sees a human-readable name even
// when the agent reports the YAML vendor id verbatim.
const HEALTH_VENDOR_LABELS: Array<[string, string]> = [
  ["tomedo-db", "Tomedo (Datenbank-Lesepfad)"],
  ["tomedo", "Tomedo"],
  ["medatixx", "medatixx (Firebird)"],
  ["cgm-albis", "CGM Albis (Postgres)"],
  ["cgm-turbomed", "CGM Turbomed (Firebird)"],
  ["cgm-m1pro", "CGM M1 Pro (SQL Server)"],
  ["indamed", "Indamed Medical Office (MariaDB)"],
  ["quincy", "Quincy / Frey ADV (Firebird)"],
  ["pixelmedics", "Pixelmedics"],
  ["pabau", "Pabau"],
  ["consentz", "Consentz"],
];

const STREAM_LABELS: Record<string, string> = {
  PatientUpserted: "Patientenstammdaten",
  AppointmentCreated: "Termine (angelegt)",
  AppointmentStatusChanged: "Terminstatus",
  AppointmentCancelled: "Terminstornierungen",
  EncounterCompleted: "Behandlungen",
  InvoicePaid: "Rechnungen",
  RecallScheduled: "Recalls",
  PatientMerged: "Patientenzusammenführungen",
  vendor: "Verbindung",
};

const EVENT_KIND_LABELS: Record<
  string,
  { label: string; tone: "warn" | "bad" }
> = {
  schema_drift: { label: "Schema-Drift erkannt", tone: "warn" },
  stream_error: { label: "Stream-Fehler", tone: "bad" },
  auth_expired: { label: "Anmeldedaten abgelaufen", tone: "bad" },
  connection_lost: { label: "Verbindung verloren", tone: "bad" },
  rate_limited: { label: "Rate-Limit erreicht", tone: "warn" },
};

function healthVendorLabel(vendorId: string): string {
  for (const [prefix, label] of HEALTH_VENDOR_LABELS) {
    if (vendorId === prefix || vendorId.startsWith(`${prefix}-`)) return label;
  }
  return vendorId;
}

function healthDetailLines(eventKind: string, detail: unknown): string[] {
  if (!detail || typeof detail !== "object") return [];
  const lines: string[] = [];
  if (eventKind === "schema_drift") {
    const d = detail as { missing?: string[]; added?: string[] };
    if (d.missing && d.missing.length > 0) {
      lines.push(`Fehlende Spalten: ${d.missing.join(", ")}`);
    }
    if (d.added && d.added.length > 0) {
      lines.push(`Neue Spalten: ${d.added.join(", ")}`);
    }
  } else if (eventKind === "stream_error") {
    const d = detail as { reason?: string; consecutiveFailures?: number };
    if (d.reason) lines.push(`Ursache: ${d.reason}`);
    if (typeof d.consecutiveFailures === "number") {
      lines.push(`Aufeinanderfolgende Fehlversuche: ${d.consecutiveFailures}`);
    }
  } else if (
    eventKind === "auth_expired" ||
    eventKind === "connection_lost" ||
    eventKind === "rate_limited"
  ) {
    const d = detail as { reason?: string; retryAfterSeconds?: number };
    if (d.reason) lines.push(`Hinweis: ${d.reason}`);
    if (typeof d.retryAfterSeconds === "number") {
      lines.push(`Wiederversuch in ${d.retryAfterSeconds} s`);
    }
  }
  return lines;
}

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

  const [clinicAds] = await db
    .select({
      metaPixelId: schema.clinics.metaPixelId,
      googleAdsCustomerId: schema.clinics.googleAdsCustomerId,
      googleAdsConversionAction: schema.clinics.googleAdsConversionAction,
    })
    .from(schema.clinics)
    .where(eq(schema.clinics.id, session.clinicId))
    .limit(1);
  const adsConversionReady = Boolean(
    clinicAds?.metaPixelId ||
      (clinicAds?.googleAdsCustomerId && clinicAds?.googleAdsConversionAction)
  );

  const [link] = await db
    .select({
      id: schema.pvsLink.id,
      vendor: schema.pvsLink.pvsVendor,
      status: schema.pvsLink.status,
      preferredPath: schema.pvsLink.preferredPath,
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

  // Phase 4: unresolved health signals from the bridge. Renders a warning
  // card directly under the link state so the Praxis IT contact sees drift
  // before they wonder why a stream went quiet.
  const healthRows = await listUnresolvedHealth(session.clinicId, 20);

  const vendor = link?.vendor ?? "none";
  const status = link?.status ?? "unconfigured";
  const preferredPath = link?.preferredPath ?? "auto";
  const vendorLabel = VENDOR_LABELS[vendor] ?? vendor;
  const statusInfo = STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };
  // Tomedo is the only vendor today with both a cloud REST path and an
  // on-prem DB-read path. For any other vendor the choice is degenerate,
  // so the badge stays hidden.
  const isMultiPathVendor = vendor === "tomedo";
  const pathLabel: { label: string; tone: "neutral" | "good" } | null =
    isMultiPathVendor
      ? preferredPath === "db_read"
        ? { label: "Lesepfad: Datenbank (lokal)", tone: "good" }
        : preferredPath === "rest"
          ? { label: "Lesepfad: Cloud (REST)", tone: "good" }
          : { label: "Lesepfad: automatisch", tone: "neutral" }
      : null;

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">PVS-Integration</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Verbindung Ihrer Praxis-Software (Tomedo, medatixx, RED, etc.) mit dem
            EINS Portal. Sobald aktiv, leitet das Portal Status (Termin, behandelt,
            gewonnen) und Umsatz aus echten PVS-Daten ab: keine manuellen Einträge mehr.
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
          <div className="flex flex-col items-end gap-1">
            <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
            {pathLabel && (
              <Badge tone={pathLabel.tone}>{pathLabel.label}</Badge>
            )}
          </div>
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
                {link?.updatedAt ? formatDateTime(link.updatedAt) : "k. A."}
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

      {/* Health warnings from the bridge (Phase 4: schema-drift + transient errors). */}
      {healthRows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5" />
                PVS-Verbindung benötigt Aufmerksamkeit
              </CardTitle>
              <CardDescription>
                Der EINS-Agent meldet {healthRows.length}{" "}
                {healthRows.length === 1 ? "offenen Vorfall" : "offene Vorfälle"}.
                Solange ein Stream auf Schema-Drift steht, sendet er bewusst
                keine Events mehr, damit kein leerer Datenstrom in die Auswertung
                läuft.
              </CardDescription>
            </div>
            <Badge tone="warn">{healthRows.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {healthRows.map((row) => {
              const kindInfo =
                EVENT_KIND_LABELS[row.eventKind] ?? {
                  label: row.eventKind,
                  tone: "warn" as const,
                };
              const detail = healthDetailLines(row.eventKind, row.detail);
              return (
                <div
                  key={row.id}
                  className="rounded-lg border bg-muted/40 p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={kindInfo.tone}>{kindInfo.label}</Badge>
                    <span className="font-medium">
                      {healthVendorLabel(row.pvsVendor)}
                    </span>
                    <span className="text-muted-foreground">
                      ·{" "}
                      {STREAM_LABELS[row.streamKind] ?? row.streamKind}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {formatRelative(row.detectedAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{row.message}</p>
                  {detail.length > 0 && (
                    <ul className="mt-2 list-disc pl-5 text-xs text-muted-foreground">
                      {detail.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <p className="text-xs text-muted-foreground">
              Behebung: Praxis-IT prüft die im Onboarding-Doc beschriebenen
              Schritte (Spaltenname in der vendor YAML angleichen, Anmeldedaten
              rotieren, Firewall-Regel) und startet den Agent neu. Der nächste
              erfolgreiche Poll markiert den Vorfall automatisch als behoben.
            </p>
          </CardContent>
        </Card>
      )}

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

      {/* Closed-loop attribution config (Meta CAPI + Google OCI) */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Conversion-Tracking: Meta + Google
            </CardTitle>
            <CardDescription>
              Sendet bei jeder bezahlten Rechnung den echten EUR-Wert zurück an
              Meta CAPI und Google Ads OCI. Algorithmus lernt auf
              Umsatz-Patient:innen statt auf billige Klicks.
            </CardDescription>
          </div>
          <Badge tone={adsConversionReady ? "good" : "neutral"}>
            {adsConversionReady ? "Aktiv" : "Nicht eingerichtet"}
          </Badge>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/einstellungen/integrationen/ads-conversion">
              Conversion-Einstellungen öffnen
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
