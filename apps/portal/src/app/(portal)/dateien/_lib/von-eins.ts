import type { DocumentKind } from "@/lib/constants";
import { fileExtension } from "@/lib/uploads";

/** "Hauptvertrag EINS.pdf": the title plus the stored file's extension,
 *  without the characters Windows and macOS refuse in a file name. The name
 *  a document is saved under, by its own "Herunterladen" and inside "Alle
 *  herunterladen" alike. */
export function documentFileName(title: string, storageKey: string): string {
  const ext = fileExtension(storageKey) || "pdf";
  const base = title.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "Dokument";
  return `${base}.${ext}`;
}

/**
 * Produkt-Dokumentation: für jede Praxis gleich. Liegt als statisches Asset
 * unter public/ und wird mit jedem Deploy ausgeliefert, also ohne Mandanten-
 * Zeile in der DB. Ohne Art-Filter oben in "Von EINS", beim Filtern auf eine
 * Art ausgeblendet. Shared by the page and "Alle herunterladen" (actions.ts).
 */
export const PINNED_DOCS = [
  {
    key: "anleitung",
    label: "Anleitung",
    title: "EINS Portal: Die komplette Anleitung",
    href: "/anleitung/eins-portal-anleitung.pdf",
    downloadName: "EINS Portal - Die komplette Anleitung.pdf",
  },
  {
    key: "checkliste",
    label: "Checkliste",
    title: "Asset-Liefer-Checkliste: Alles für den Start",
    href: "/anleitung/eins-asset-checkliste.pdf",
    downloadName: "EINS Asset-Liefer-Checkliste.pdf",
  },
] as const;

/** Short names for the Art filter, so the control fits beside the card title
 *  on the phone; also the name of a ZIP of one Art. The rows keep the full
 *  names. */
export const KIND_FILTER_LABELS: Record<DocumentKind, string> = {
  vertrag: "Verträge",
  avv: "AVV",
  auswertung_monatlich: "Auswertungen",
  vertriebsleitfaden: "Leitfäden",
  hwg_pruefung: "HWG-Prüfungen",
  sonstiges: "Sonstiges",
};
