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
import { ShieldAlert } from "lucide-react";

/**
 * /einstellungen/integrationen
 *
 * Overview of the clinic's PVS Bridge state:
 *   • Current pvs_link record (vendor, status, last event).
 *   • Counts of open linking failures.
 *   • Links to the per-vendor setup wizard + inbox.
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
  // Phase 7 per-Praxis DB-read engines (on-prem agent, Lesepfad Datenbank).
  medatixx: "medatixx",
  cgm_albis: "CGM Albis",
  cgm_turbomed: "CGM Turbomed",
  cgm_m1pro: "CGM M1 Pro",
  indamed: "Indamed Medical Office",
  quincy: "Quincy / Frey ADV",
  pixelmedics: "Pixelmedics",
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
  schema_drift: { label: "Datenaufbau hat sich geändert", tone: "warn" },
  stream_error: { label: "Datenstrom gestört", tone: "bad" },
  auth_expired: { label: "Anmeldedaten abgelaufen", tone: "bad" },
  connection_lost: { label: "Verbindung verloren", tone: "bad" },
  rate_limited: { label: "Zu viele Abfragen, kurze Pause", tone: "warn" },
  config_invalid: { label: "Konfiguration prüfen", tone: "bad" },
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
  } else if (eventKind === "config_invalid") {
    const d = detail as {
      sampleSize?: number;
      passingRows?: number;
      issues?: Array<{
        field?: string;
        reason?: string;
        sampleRawValues?: string[];
      }>;
    };
    if (
      typeof d.passingRows === "number" &&
      typeof d.sampleSize === "number"
    ) {
      lines.push(
        `Stichprobe: ${d.passingRows} von ${d.sampleSize} Zeilen gültig`
      );
    }
    for (const issue of d.issues ?? []) {
      if (!issue.field) continue;
      const samples =
        issue.sampleRawValues && issue.sampleRawValues.length > 0
          ? ` (Beispiele: ${issue.sampleRawValues.join(", ")})`
          : "";
      lines.push(
        `Feld ${issue.field}: ${issue.reason ?? "unerwartete Werte"}${samples}`
      );
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
  pending: { label: "Wartet auf erste Daten", tone: "warn" },
  connected: { label: "Verbunden", tone: "good" },
  error: { label: "Fehler", tone: "bad" },
  disconnected: { label: "Getrennt", tone: "neutral" },
};

export default async function IntegrationenPage() {
  const session = await requireSession();

  const [link] = await db
    .select({
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

  // Phase 4: unresolved health signals from the bridge. Renders a warning
  // card directly under the link state so the Praxis IT contact sees drift
  // before they wonder why a stream went quiet.
  const healthRows = await listUnresolvedHealth(session.clinicId, 20);

  const vendor = link?.vendor ?? "none";
  const status = link?.status ?? "unconfigured";
  const vendorLabel = VENDOR_LABELS[vendor] ?? vendor;
  const statusInfo = STATUS_LABELS[status] ?? { label: status, tone: "neutral" as const };

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">PVS-Integration</h1>
          <p className="mt-1 text-base text-fg-primary">
            Verbindung Ihrer Praxis-Software (Tomedo, medatixx, RED usw.) mit dem
            EINS Portal. Sobald aktiv, übernimmt das Portal Termin, Behandlung und
            Umsatz direkt aus Ihrer Praxis-Software: keine manuellen Einträge mehr.
          </p>
          <p className="mt-1 text-sm text-fg-secondary">
            PVS heißt Praxisverwaltungssystem: die Software, in der Ihre Praxis
            Termine, Patienten und Rechnungen führt.
          </p>
        </div>
      </header>

      {/* Current link state */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              {vendorLabel}
            </CardTitle>
            <CardDescription>
              {link?.lastEventAt
                ? `Letzte Meldung aus der Praxis-Software: ${formatRelative(link.lastEventAt)}`
                : "Noch keine Meldung aus der Praxis-Software erhalten"}
            </CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            <div>
              <div className="font-medium text-fg-primary">Zuletzt aktualisiert</div>
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
                  CSV-Datei nachladen
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
                Der EINS-Agent (das kleine Programm auf Ihrem Praxisrechner)
                meldet {healthRows.length}{" "}
                {healthRows.length === 1 ? "offenen Vorfall" : "offene Vorfälle"}.
                Solange sich der Datenaufbau geändert hat, sendet er bewusst
                nichts, damit keine falschen Zahlen in Ihre Auswertung laufen.
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
                  className="rounded-lg border border-border bg-bg-secondary p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={kindInfo.tone}>{kindInfo.label}</Badge>
                    <span className="font-medium">
                      {healthVendorLabel(row.pvsVendor)}
                    </span>
                    <span className="text-fg-secondary">
                      ·{" "}
                      {STREAM_LABELS[row.streamKind] ?? row.streamKind}
                    </span>
                    <span className="ml-auto text-sm text-fg-secondary">
                      {formatRelative(row.detectedAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm">{row.message}</p>
                  {detail.length > 0 && (
                    <ul className="mt-2 list-disc break-words pl-5 text-sm text-fg-secondary">
                      {detail.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <p className="text-sm text-fg-secondary">
              Behebung: Ihre Praxis-IT geht die Schritte aus der
              Einrichtungsanleitung durch (Spaltenname in der Anbieter-Datei
              angleichen, Zugangsdaten erneuern, Firewall-Regel prüfen) und
              startet den EINS-Agent neu. Sobald wieder Daten ankommen, gilt der
              Vorfall automatisch als behoben.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Operational signals */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            Nicht zuordenbare Patienten
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">{openFailureCount}</div>
          <p className="mt-1 text-sm text-fg-secondary">
            Meldungen aus der Praxis-Software, bei denen wir die Person nicht
            sicher einer Anfrage im Portal zuordnen konnten.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link href="/einstellungen/integrationen/links">Liste öffnen</Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              Google Ads
            </CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="h-auto min-h-11 whitespace-normal py-2 text-left">
            <Link href="/einstellungen/integrationen/ads-conversion">
              Einstellungen für Google Ads öffnen
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
