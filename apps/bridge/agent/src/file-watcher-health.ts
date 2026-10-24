import type { GdtWatcherStatus } from "./watcher.js";
import type { CsvWatcherStatus } from "./csv-watcher.js";

/**
 * Express the file watchers' health in the heartbeat's existing
 * `adapterStatuses` shape, so the portal's stream_halted alert (statuses
 * error / schema_drift / config_invalid, shown to the Praxis and, with ops
 * alerting, to EINS) also covers the GDT inbox and the Honorar-CSV folder.
 * No new portal field is needed; older portals store the rows as-is.
 *
 * Only conditions that need a human are reported as halted:
 *   - GDT: a file addressed to EINS cannot be claimed or read (retrying).
 *     With a fixed-name `.GDT` channel that blocks the PVS's next export,
 *     so it is urgent. Usual cause: missing write/delete permission on the
 *     GDT folder for the account the agent runs as.
 *   - GDT: the folder cannot be listed at all.
 *   - CSV: the newest file was ignored because no usable header/mapping was
 *     found (or a mapped column appears twice), it was too large to read,
 *     or a file keeps failing to read.
 * Quarantined GDT files (.eins\failed) do not block anything and are
 * reported as "degraded" (stored, visible, no alert).
 */

export interface WatcherStreamStatus {
  vendor: string;
  stream: string;
  status: "ok" | "degraded" | "error" | "config_invalid";
  lastError: string | null;
  connectError: string | null;
  consecutiveFailures: number;
  lastRunAt: number | null;
}

const CSV_CONFIG_REASONS = [
  "no_header_found",
  "no_mapping",
  "ambiguous_amount_columns",
  "duplicate_mapped_columns",
  "all_rows_invalid",
];

/** Ignore reasons where the whole file's rows are lost, not a mapping issue. */
const CSV_LOST_FILE_REASONS = ["file_too_large", "row_cap_exceeded"];

export function gdtWatcherHealth(s: GdtWatcherStatus | null): WatcherStreamStatus[] {
  if (!s) return [];
  const lastRunAt = s.lastFileAt ? Date.parse(s.lastFileAt) : null;
  // Health comes from structured counters, never from error message text: a
  // stale lastError string must not keep an alert alive after recovery.
  if ((s.consecutiveListingFailures ?? 0) >= 2) {
    return [
      {
        vendor: "gdt_agent",
        stream: "gdt_inbox",
        status: "error",
        lastError: `GDT-Ordner nicht lesbar (${s.consecutiveListingFailures} Versuche in Folge): ${s.lastError ?? "unbekannt"}`,
        connectError: null,
        consecutiveFailures: s.consecutiveListingFailures,
        lastRunAt,
      },
    ];
  }
  if ((s.retryingSevere ?? 0) > 0) {
    return [
      {
        vendor: "gdt_agent",
        stream: "gdt_inbox",
        status: "error",
        lastError:
          `${s.retryingFiles} GDT-Datei(en) können nicht übernommen werden ` +
          `(Schreib-/Löschrecht des Agent-Kontos auf dem GDT-Ordner prüfen). ${s.lastError ?? ""}`.trim(),
        connectError: null,
        consecutiveFailures: s.retryingFiles,
        lastRunAt,
      },
    ];
  }
  const notes: string[] = [];
  if (s.retryingFiles > 0) {
    notes.push(`${s.retryingFiles} GDT-Datei(en) werden gerade erneut versucht.`);
  }
  if ((s.misaddressedFiles ?? 0) > 0) {
    notes.push(
      `${s.misaddressedFiles} GDT-Datei(en) tragen im Dateinamen die EINS-Empfänger-ID, ` +
        `nennen aber in FK 8315 "${s.misaddressedDetail ?? "?"}" statt "${s.receiverId}". ` +
        `Sie bleiben unberührt im GDT-Ordner; Empfänger-ID im PVS oder im Agent angleichen.`
    );
  }
  if ((s.droppedFiles ?? 0) > 0) {
    notes.push(
      `${s.droppedFiles} GDT-Datei(en) ohne verwertbaren Patientensatz (FK 3000 fehlt) in .eins\\failed abgelegt`
    );
  }
  // droppedFiles are a subset of quarantinedFiles (same folder, same retention).
  const unreadable = s.quarantinedFiles - (s.droppedFiles ?? 0);
  if (unreadable > 0) {
    notes.push(`${unreadable} unlesbare GDT-Datei(en) in .eins\\failed abgelegt`);
  }
  if ((s.stuckAttempts ?? 0) >= 2 && (s.stuckClaimed ?? 0) > 0) {
    notes.push(
      `${s.stuckClaimed} übernommene GDT-Datei(en) hängen in .eins\\processing (Speicher/Virenscanner prüfen)`
    );
  }
  return [
    {
      vendor: "gdt_agent",
      stream: "gdt_inbox",
      status: notes.length > 0 ? "degraded" : "ok",
      lastError: notes.length > 0 ? notes.join(" ") : null,
      connectError: null,
      consecutiveFailures: 0,
      lastRunAt,
    },
  ];
}

/**
 * Pass 2: GDT and Honorar CSV configured to the same folder. The agent keeps
 * running (GDT, DB adapters, uploads) and only leaves the CSV watcher off;
 * this row makes the portal raise config_invalid with the fix, instead of the
 * whole agent exiting after an upgrade and every stream going dark.
 */
export function csvFolderConflictHealth(conflict: string | null): WatcherStreamStatus[] {
  if (!conflict) return [];
  return [
    {
      vendor: "honorar_csv",
      stream: "csv_folder",
      status: "config_invalid",
      lastError: `${conflict} Honorar-Export wird nicht gelesen. Beheben mit: eins-agent --configure-honorar <anderer Ordner>`.slice(0, 1_000),
      connectError: null,
      consecutiveFailures: 1,
      lastRunAt: null,
    },
  ];
}

export function csvWatcherHealth(s: CsvWatcherStatus | null): WatcherStreamStatus[] {
  if (!s) return [];
  const lastRunAt = s.lastProcessedAt ? Date.parse(s.lastProcessedAt) : null;
  const failed = s.ledger?.failed ?? 0;
  // The ledger survives agent restarts; the in-memory reason does not. An
  // ignored file is never re-read, so after a restart only the ledger still
  // knows about it (otherwise health would flip to ok and the portal would
  // auto-resolve the alert).
  const reason = s.ledger?.lastIgnoredReason ?? s.lastIgnoreReason ?? "";
  const configProblem = CSV_CONFIG_REASONS.some((r) => reason.startsWith(r));
  if (configProblem) {
    const cols = s.lastHeaderColumns.length > 0 ? ` Gefundene Spalten: ${s.lastHeaderColumns.join(", ")}` : "";
    return [
      {
        vendor: "honorar_csv",
        stream: "csv_folder",
        status: "config_invalid",
        lastError: `Honorar-Export nicht auswertbar (${reason}).${cols}`.slice(0, 1_000),
        connectError: null,
        consecutiveFailures: s.ledger?.ignored ?? 1,
        lastRunAt,
      },
    ];
  }
  if (CSV_LOST_FILE_REASONS.some((r) => reason.startsWith(r))) {
    return [
      {
        vendor: "honorar_csv",
        stream: "csv_folder",
        status: "error",
        lastError: `Honorar-Export zu groß, nicht übernommen (${reason}). Export in kleinere Zeiträume aufteilen.`.slice(0, 1_000),
        connectError: null,
        consecutiveFailures: 1,
        lastRunAt,
      },
    ];
  }
  if (failed > 0) {
    return [
      {
        vendor: "honorar_csv",
        stream: "csv_folder",
        status: "error",
        lastError: `${failed} Honorar-Datei(en) können nicht gelesen werden (${s.ledger?.lastError ?? "unbekannt"})`,
        connectError: null,
        consecutiveFailures: failed,
        lastRunAt,
      },
    ];
  }
  return [
    {
      vendor: "honorar_csv",
      stream: "csv_folder",
      status: "ok",
      lastError: null,
      connectError: null,
      consecutiveFailures: 0,
      lastRunAt,
    },
  ];
}
