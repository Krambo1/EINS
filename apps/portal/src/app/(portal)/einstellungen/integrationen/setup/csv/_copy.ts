import type { Tone } from "../../../_components/settings-ui";

/** Fixed texts and labels of the CSV page, shared with `loading.tsx` and the wizard. */

export const STREAM_FIELD = "Welche Daten enthält die Datei?";
export const STREAM_HINT = "Pro Datenart eine Datei. Haben Sie mehrere, laden Sie sie nacheinander hoch.";
export const FILE_FIELD = "CSV-Datei";
export const FILE_HINT =
  "Höchstens 4 MB. Zeichensatz, Trennzeichen sowie Titel- und Summenzeilen erkennen wir automatisch.";

/** A CSV upload's status, the same words in the wizard and in "Bisherige Uploads". */
export const UPLOAD_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Wartet", tone: "none" },
  processing: { label: "Läuft", tone: "none" },
  completed: { label: "Fertig", tone: "good" },
  failed: { label: "Fehlgeschlagen", tone: "bad" },
  cancelled: { label: "Abgebrochen", tone: "none" },
};

export function uploadStatus(status: string): { label: string; tone: Tone } {
  return UPLOAD_STATUS[status] ?? { label: status, tone: "none" };
}

/** The file field: a well with the browser's own picker button raised inside it. */
export const FILE_INPUT =
  "elev-inset block h-[var(--control-h)] w-full cursor-pointer rounded-[var(--r-control)] bg-[var(--well)] pr-3 text-sm text-fg-secondary file:mr-3 file:h-full file:cursor-pointer file:rounded-l-[var(--r-control)] file:border-0 file:bg-[var(--surface-raised)] file:px-3.5 file:text-sm file:font-medium file:text-fg-primary file:shadow-[inset_-1px_0_0_var(--border)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
