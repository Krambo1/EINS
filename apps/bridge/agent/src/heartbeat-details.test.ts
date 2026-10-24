import { describe, expect, it } from "vitest";
import { csvWatcherDetails, gdtWatcherDetails } from "./heartbeat-details.js";
import type { GdtWatcherStatus } from "./watcher.js";
import type { CsvWatcherStatus } from "./csv-watcher.js";

const GDT: GdtWatcherStatus = {
  folder: "C:\\GDT-Out",
  receiverId: "EINS",
  consumedFiles: 4,
  eventsEnqueued: 9,
  ignoredFiles: 2,
  retryingFiles: 1,
  quarantinedFiles: 3,
  retryingSevere: 1,
  droppedFiles: 1,
  misaddressedFiles: 1,
  misaddressedDetail: "EKG1",
  stuckClaimed: 0,
  stuckAttempts: 0,
  consecutiveListingFailures: 0,
  lastRescanOkAt: "2026-10-07T08:00:00.000Z",
  lastFileAt: "2026-10-07T07:59:00.000Z",
  lastError: null,
};

const CSV: CsvWatcherStatus = {
  folder: "C:\\Honorar",
  ledger: null,
  lastProcessedAt: "2026-10-07T07:00:00.000Z",
  lastIgnoreReason: "no_mapping",
  lastHeaderColumns: ["Datum", "Betrag"],
  lastFile: { name: "patient-mueller.csv", rows: 10, invoices: 8, inserted: 7, duplicates: 1 },
  lastRescanAt: null,
};

describe("heartbeat file-watcher details", () => {
  it("passes the GDT counters and never the folder path", () => {
    const d = gdtWatcherDetails(GDT)!;
    expect(d).toMatchObject({
      quarantinedFiles: 3,
      droppedFiles: 1,
      misaddressedFiles: 1,
      misaddressedDetail: "EKG1",
      retryingSevere: 1,
    });
    expect(JSON.stringify(d)).not.toContain("GDT-Out");
  });

  it("passes the CSV skip and ignore reasons, defensively, and never a file name", () => {
    const withExtras = {
      ...CSV,
      skippedRows: 12,
      lastSkipReason: "invalid_amount",
      lastIgnoredReason: "no_header_found",
    } as CsvWatcherStatus;
    expect(csvWatcherDetails(withExtras)).toMatchObject({
      skippedRows: 12,
      lastSkipReason: "invalid_amount",
      lastIgnoredReason: "no_header_found",
    });
    const plain = csvWatcherDetails(CSV)!;
    expect(plain.skippedRows).toBeNull();
    expect(plain.lastIgnoredReason).toBe("no_mapping");
    expect(JSON.stringify(plain)).not.toContain("mueller");
  });

  it("is null when a watcher is not running", () => {
    expect(gdtWatcherDetails(null)).toBeNull();
    expect(csvWatcherDetails(null)).toBeNull();
  });
});
