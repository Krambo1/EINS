import { formatRelative } from "@/lib/formatting";
import type { Tone } from "../_components/settings-ui";

/**
 * Names and states of the Praxis-Software connection (pvs_link), shared by
 * the "Praxis-Software" row on Einstellungen and the page behind it.
 */
export const PVS_VENDOR_LABELS: Record<string, string> = {
  tomedo: "Tomedo",
  healthhub: "medatixx HealthHub",
  red: "RED interchange",
  pabau: "Pabau",
  consentz: "Consentz",
  gdt_agent: "GDT-Agent",
  csv_upload: "CSV-Datei",
  n8n_custom: "n8n-Ablauf",
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

export const PVS_STATUS: Record<string, { label: string; tone: Tone }> = {
  unconfigured: { label: "Nicht eingerichtet", tone: "none" },
  akkreditierung: { label: "Akkreditierung läuft", tone: "warn" },
  pending: { label: "Wartet auf erste Daten", tone: "warn" },
  connected: { label: "Verbunden", tone: "good" },
  error: { label: "Fehler", tone: "bad" },
  disconnected: { label: "Getrennt", tone: "none" },
};

export function pvsStatus(status: string | null | undefined): { label: string; tone: Tone } {
  const key = status ?? "unconfigured";
  return PVS_STATUS[key] ?? { label: key, tone: "none" };
}

/**
 * The status line under the software's name, the same words on Einstellungen
 * and on Praxis-Software: where the link stands and, once something came in,
 * when the last report arrived.
 */
export function pvsLine(
  link: { status: string | null; lastEventAt: Date | null } | null
): { text: string; tone: Tone } {
  const status = pvsStatus(link?.status);
  const text = link?.lastEventAt
    ? `${status.label}, letzte Meldung ${formatRelative(link.lastEventAt)}`
    : status.label;
  return { text, tone: status.tone };
}
