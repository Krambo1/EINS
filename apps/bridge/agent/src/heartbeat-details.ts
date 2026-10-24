import type { GdtWatcherStatus } from "./watcher.js";
import type { CsvWatcherStatus } from "./csv-watcher.js";

/**
 * The raw counters behind the file-watcher rows of the heartbeat's
 * `adapterStatuses`, for the admin detail view. `adapterStatuses` carries the
 * verdict (ok / degraded / error); these carry the numbers a human needs to see
 * WHY (how many GDT files are quarantined, how many Honorar rows were skipped
 * and for what category of reason).
 *
 * Privacy: counts and reason categories only. No file names (a GDT or CSV name
 * can contain a patient name), no cell values, no paths.
 */

export type WatcherDetails = Record<string, string | number | null>;

function clip(value: string | null | undefined, max = 300): string | null {
  if (typeof value !== "string" || value === "") return null;
  return value.length > max ? value.slice(0, max) : value;
}

export function gdtWatcherDetails(s: GdtWatcherStatus | null): WatcherDetails | null {
  if (!s) return null;
  return {
    receiverId: s.receiverId,
    consumedFiles: s.consumedFiles,
    eventsEnqueued: s.eventsEnqueued,
    ignoredFiles: s.ignoredFiles,
    retryingFiles: s.retryingFiles,
    retryingSevere: s.retryingSevere ?? 0,
    quarantinedFiles: s.quarantinedFiles,
    droppedFiles: s.droppedFiles ?? 0,
    misaddressedFiles: s.misaddressedFiles ?? 0,
    misaddressedDetail: clip(s.misaddressedDetail, 100),
    stuckClaimed: s.stuckClaimed ?? 0,
    stuckAttempts: s.stuckAttempts ?? 0,
    consecutiveListingFailures: s.consecutiveListingFailures ?? 0,
    lastRescanOkAt: s.lastRescanOkAt,
    lastFileAt: s.lastFileAt,
    lastError: clip(s.lastError),
  };
}

/** Fields the CSV watcher status gains from the Honorar-CSV work; read defensively. */
type CsvStatusExtras = {
  skippedRows?: number | null;
  lastSkipReason?: string | null;
  lastIgnoredReason?: string | null;
};

export function csvWatcherDetails(s: CsvWatcherStatus | null): WatcherDetails | null {
  if (!s) return null;
  const x = s as CsvWatcherStatus & CsvStatusExtras;
  return {
    skippedRows: typeof x.skippedRows === "number" ? x.skippedRows : null,
    lastSkipReason: clip(x.lastSkipReason, 100),
    lastIgnoredReason: clip(
      x.lastIgnoredReason ?? s.ledger?.lastIgnoredReason ?? s.lastIgnoreReason,
      200
    ),
    ledgerFailed: s.ledger?.failed ?? null,
    ledgerIgnored: s.ledger?.ignored ?? null,
    lastProcessedAt: s.lastProcessedAt,
    lastRescanAt: s.lastRescanAt,
    lastFileRows: s.lastFile?.rows ?? null,
    lastFileInvoices: s.lastFile?.invoices ?? null,
    lastFileInserted: s.lastFile?.inserted ?? null,
    lastFileDuplicates: s.lastFile?.duplicates ?? null,
  };
}
