import Link from "next/link";
import { and, count, eq } from "drizzle-orm";
import { ChevronRight } from "lucide-react";
import { Button, cn } from "@eins/ui";
import { requireSession } from "@/auth/guards";
import { db, schema } from "@/db/client";
import { formatRelative } from "@/lib/formatting";
import { can } from "@/lib/roles";
import { listUnresolvedHealth } from "@/server/pvs-health";
import { WASH_AREA, WASH_ROW } from "../../../dashboard/_components/dash-ui";
import { SettingsHead } from "../../_components/SettingsHead";
import {
  CardBody,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SettingsCard,
  Status,
  type Tone,
} from "../../_components/settings-ui";
import { PVS_VENDOR_LABELS, pvsLine } from "../../_lib/pvs";
import { COLUMNS, LINK_ROW, ONE_LINE, STACK } from "../../_lib/sizes";

/**
 * /einstellungen/integrationen, "Praxis-Software": where the link to the
 * Praxis-Software stands (pvs_link), the way to set it up or change it, the
 * open matches, and the bridge's open incidents. Any role may look, as
 * before; the pages behind it check their own permissions. A role without
 * `settings.integrations` gets "Ansehen", as on the main page's row, not
 * buttons for steps it cannot take (the CSV page sends it away).
 */

export const metadata = { title: "Praxis-Software" };

// Health-event labels for the incident rows. Vendor IDs from the db-adapter
// YAMLs are matched as prefixes (e.g. "tomedo-db" → "Tomedo
// (Datenbank-Lesepfad)") so the Praxis sees a readable name even when the
// agent reports the YAML vendor id verbatim.
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

const EVENT_KIND_LABELS: Record<string, { label: string; tone: Tone }> = {
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
    if (typeof d.passingRows === "number" && typeof d.sampleSize === "number") {
      lines.push(`Stichprobe: ${d.passingRows} von ${d.sampleSize} Zeilen gültig`);
    }
    for (const issue of d.issues ?? []) {
      if (!issue.field) continue;
      const samples =
        issue.sampleRawValues && issue.sampleRawValues.length > 0
          ? ` (Beispiele: ${issue.sampleRawValues.join(", ")})`
          : "";
      lines.push(`Feld ${issue.field}: ${issue.reason ?? "unerwartete Werte"}${samples}`);
    }
  } else if (eventKind === "auth_expired" || eventKind === "connection_lost" || eventKind === "rate_limited") {
    const d = detail as { reason?: string; retryAfterSeconds?: number };
    if (d.reason) lines.push(`Hinweis: ${d.reason}`);
    if (typeof d.retryAfterSeconds === "number") {
      lines.push(`Wiederversuch in ${d.retryAfterSeconds} s`);
    }
  }
  return lines;
}

export default async function PraxisSoftwarePage() {
  const session = await requireSession();

  const [linkRows, failureRows, healthRows] = await Promise.all([
    db
      .select({
        vendor: schema.pvsLink.pvsVendor,
        status: schema.pvsLink.status,
        lastEventAt: schema.pvsLink.lastEventAt,
      })
      .from(schema.pvsLink)
      .where(eq(schema.pvsLink.clinicId, session.clinicId))
      .limit(1),
    db
      .select({ n: count() })
      .from(schema.linkingFailures)
      .where(and(eq(schema.linkingFailures.clinicId, session.clinicId), eq(schema.linkingFailures.status, "open"))),
    // Unresolved health signals from the bridge, so the Praxis IT sees drift
    // before anyone wonders why a stream went quiet.
    listUnresolvedHealth(session.clinicId, 20),
  ]);
  const link = linkRows[0] ?? null;
  const openFailureCount = failureRows[0]?.n ?? 0;
  const vendor = link?.vendor ?? "none";
  const line = pvsLine(link);
  const canSetUp = can(session.role, "settings.integrations");
  const incidentTone: Tone = healthRows.some((r) => EVENT_KIND_LABELS[r.eventKind]?.tone === "bad") ? "bad" : "warn";

  return (
    <div className={STACK}>
      <SettingsHead title="Praxis-Software" />

      <div className={COLUMNS}>
        <div className={STACK}>
          <SettingsCard id="verbindung" title="Verbindung">
            <CardBody className="pt-2">
              <ul className="divide-y divide-border">
                {/* The Werbekonten row's anatomy: name, dot and where the link
                    stands, the actions at the end (below lg on a line of
                    their own, short words on the phone). */}
                <li className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0">
                    <p className="text-[15px] font-medium leading-6 text-fg-primary">
                      {vendor === "none" ? "Ihre Praxis-Software" : (PVS_VENDOR_LABELS[vendor] ?? vendor)}
                    </p>
                    <div className="mt-1 flex min-h-6 items-center">
                      <Status tone={line.tone} className="min-w-0 max-w-full">
                        <span className={cn(ONE_LINE, "min-w-0")}>{line.text}</span>
                      </Status>
                    </div>
                  </div>
                  <div className="flex w-full gap-2 lg:w-auto">
                    {canSetUp ? (
                      <>
                        <Button
                          asChild
                          variant={vendor === "none" ? "default" : "outline"}
                          className={vendor === "none" ? PRIMARY_BUTTON : SECONDARY_BUTTON}
                        >
                          <Link href="/einstellungen/integrationen/setup">
                            {vendor === "none" ? "Verbindung einrichten" : "Anbieter wechseln"}
                          </Link>
                        </Button>
                        {vendor !== "none" && (
                          <Button asChild variant="outline" className={SECONDARY_BUTTON}>
                            <Link href="/einstellungen/integrationen/setup/csv">
                              <span className="sm:hidden">Datei nachladen</span>
                              <span className="hidden sm:inline">CSV-Datei nachladen</span>
                            </Link>
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button asChild variant="outline" className={SECONDARY_BUTTON}>
                        <Link href="/einstellungen/integrationen/setup">Ansehen</Link>
                      </Button>
                    )}
                  </div>
                </li>
                <li className={WASH_ROW}>
                  <Link
                    href="/einstellungen/integrationen/links"
                    className={cn(
                      LINK_ROW,
                      WASH_AREA,
                      "rounded-[var(--r-control)] text-[15px] font-medium text-fg-primary transition-colors hover:bg-[var(--hover-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    )}
                  >
                    <span className="min-w-0 flex-1">Nicht zuordenbare Patienten</span>
                    <Status tone={openFailureCount > 0 ? "warn" : "none"} className="shrink-0 font-normal">
                      {openFailureCount > 0 ? `${openFailureCount} offen` : "Keine offen"}
                    </Status>
                    <ChevronRight className="h-4 w-4 shrink-0 text-fg-tertiary" aria-hidden />
                  </Link>
                </li>
              </ul>
            </CardBody>
          </SettingsCard>

          {healthRows.length > 0 && (
            <SettingsCard
              id="vorfaelle"
              title="Vorfälle"
              action={<Status tone={incidentTone}>{healthRows.length} offen</Status>}
            >
              <CardBody>
                <p className="text-[15px] leading-6 text-fg-primary">
                  Solange sich der Datenaufbau geändert hat, sendet der EINS-Agent bewusst nichts, damit keine
                  falschen Zahlen in Ihre Auswertung laufen. Ihre Praxis-IT geht die Schritte aus der
                  Einrichtungsanleitung durch (Spaltenname in der Anbieter-Datei angleichen, Zugangsdaten
                  erneuern, Firewall-Regel prüfen) und startet den EINS-Agent neu. Sobald wieder Daten
                  ankommen, gilt der Vorfall automatisch als behoben.
                </p>
                <ul className="scroll-shadows -mx-1 mt-4 max-h-[32rem] overflow-y-auto px-1 [--scroll-bg:var(--surface-tile)] [&>li]:border-t [&>li]:border-border">
                  {healthRows.map((row) => {
                    const kind = EVENT_KIND_LABELS[row.eventKind] ?? { label: row.eventKind, tone: "warn" as const };
                    const detail = healthDetailLines(row.eventKind, row.detail);
                    return (
                      <li key={row.id} className="py-4">
                        <div className="flex items-center justify-between gap-3">
                          <Status tone={kind.tone} className="min-w-0 font-medium">
                            {kind.label}
                          </Status>
                          <span className="shrink-0 text-sm text-fg-secondary">{formatRelative(row.detectedAt)}</span>
                        </div>
                        <p className="mt-1 text-sm leading-5 text-fg-secondary">
                          {healthVendorLabel(row.pvsVendor)} · {STREAM_LABELS[row.streamKind] ?? row.streamKind}
                        </p>
                        <p className="mt-2 break-words text-[15px] leading-6 text-fg-primary">{row.message}</p>
                        {detail.length > 0 && (
                          <ul className="mt-1 space-y-0.5 break-words text-sm leading-5 text-fg-secondary">
                            {detail.map((d, i) => (
                              <li key={i}>{d}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </SettingsCard>
          )}
        </div>
      </div>
    </div>
  );
}
