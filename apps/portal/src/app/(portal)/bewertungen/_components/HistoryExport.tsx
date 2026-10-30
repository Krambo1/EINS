"use client";

import { Download } from "lucide-react";

export type HistoryExportRow = { date: string; platform: string; rating: string; count: number; added: number | null };

/**
 * "CSV laden" in the Verlauf header (Uberall's and Birdeye's export): the
 * rows the table shows, built in the browser, so no route is needed. Semicolons
 * and decimal commas, with a BOM, so Excel opens it in German correctly.
 */
export function HistoryExport({ rows }: { rows: HistoryExportRow[] }) {
  function download() {
    const lines = [
      "Datum;Plattform;Sterne;Anzahl;Neu seit Stand davor",
      ...rows.map((r) => [r.date, r.platform, r.rating, r.count, r.added ?? ""].join(";")),
    ];
    const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bewertungen-verlauf-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      onClick={download}
      className="flex items-center gap-1 rounded-[var(--r-small)] text-sm font-medium text-fg-primary hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <Download className="h-3.5 w-3.5" aria-hidden />
      CSV laden
    </button>
  );
}
