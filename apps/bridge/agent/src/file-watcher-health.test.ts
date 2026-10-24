import { describe, expect, it } from "vitest";
import { csvFolderConflictHealth, csvWatcherHealth, gdtWatcherHealth } from "./file-watcher-health.js";
import type { GdtWatcherStatus } from "./watcher.js";
import type { CsvWatcherStatus } from "./csv-watcher.js";

const gdtOk: GdtWatcherStatus = {
  folder: "C:/GDT",
  receiverId: "EINS",
  consumedFiles: 3,
  eventsEnqueued: 3,
  ignoredFiles: 1,
  retryingFiles: 0,
  retryingSevere: 0,
  quarantinedFiles: 0,
  droppedFiles: 0,
  misaddressedFiles: 0,
  misaddressedDetail: null,
  stuckClaimed: 0,
  stuckAttempts: 0,
  consecutiveListingFailures: 0,
  lastRescanOkAt: "2026-10-07T08:00:00.000Z",
  lastFileAt: "2026-10-07T08:00:00.000Z",
  lastError: null,
};

const csvOk: CsvWatcherStatus = {
  folder: "C:/Honorar",
  ledger: { done: 2, failed: 0, ignored: 0, lastError: null },
  lastProcessedAt: "2026-10-07T08:00:00.000Z",
  lastIgnoreReason: null,
  lastHeaderColumns: ["Pat.-Nr.", "Rechnungsnummer", "Betrag", "Zahldatum"],
  lastFile: null,
  lastRescanAt: null,
};

describe("file watcher health → heartbeat adapterStatuses", () => {
  it("healthy watchers report ok (no portal alert)", () => {
    expect(gdtWatcherHealth(gdtOk)[0].status).toBe("ok");
    expect(csvWatcherHealth(csvOk)[0].status).toBe("ok");
  });

  it("a stuck addressed GDT file halts the stream (portal raises stream_halted)", () => {
    const h = gdtWatcherHealth({ ...gdtOk, retryingFiles: 1, retryingSevere: 1, lastError: "EPERM" })[0];
    expect(h.status).toBe("error");
    expect(h.lastError).toMatch(/Löschrecht/);
  });

  it("quarantined GDT files are visible but not alerting", () => {
    expect(gdtWatcherHealth({ ...gdtOk, quarantinedFiles: 2 })[0].status).toBe("degraded");
  });

  it("an unreadable Honorar header is a config problem with the found column names", () => {
    const h = csvWatcherHealth({
      ...csvOk,
      lastIgnoreReason: "ambiguous_amount_columns: Betrag, Gesamtbetrag",
    })[0];
    expect(h.status).toBe("config_invalid");
    expect(h.lastError).toMatch(/Pat\.-Nr\./);
  });

  it("a duplicated mapped column is a config problem, an oversized export an error", () => {
    expect(
      csvWatcherHealth({ ...csvOk, lastIgnoreReason: "duplicate_mapped_columns: Betrag" })[0].status
    ).toBe("config_invalid");
    expect(
      csvWatcherHealth({ ...csvOk, lastIgnoreReason: "row_cap_exceeded: more than 200000 rows" })[0].status
    ).toBe("error");
  });

  it("a single transient listing failure or first claim failure is not an alert", () => {
    expect(
      gdtWatcherHealth({
        ...gdtOk,
        consecutiveListingFailures: 1,
        lastError: "cannot list GDT folder (ENOENT)",
      })[0].status
    ).not.toBe("error");
    const h = gdtWatcherHealth({ ...gdtOk, retryingFiles: 1, retryingSevere: 0, lastError: "EPERM" })[0];
    expect(h.status).not.toBe("error");
  });

  it("two consecutive failed listings are an error; a stale error text alone is not", () => {
    const h = gdtWatcherHealth({
      ...gdtOk,
      consecutiveListingFailures: 2,
      lastError: "cannot list GDT folder (ENOENT)",
    })[0];
    expect(h.status).toBe("error");
    expect(h.lastError).toMatch(/GDT-Ordner nicht lesbar/);
    expect(
      gdtWatcherHealth({ ...gdtOk, consecutiveListingFailures: 0, lastError: "cannot list GDT folder (ENOENT)" })[0]
        .status
    ).toBe("ok");
  });

  it("a name-addressed file with another FK 8315 is degraded and names both ids", () => {
    const h = gdtWatcherHealth({ ...gdtOk, misaddressedFiles: 1, misaddressedDetail: "EINS01" })[0];
    expect(h.status).toBe("degraded");
    expect(h.lastError).toMatch(/8315/);
    expect(h.lastError).toMatch(/EINS01/);
    expect(h.lastError).toMatch(/EINS/);
  });

  it("files dropped without events and stuck claimed files are degraded", () => {
    expect(gdtWatcherHealth({ ...gdtOk, droppedFiles: 1 })[0].status).toBe("degraded");
    expect(gdtWatcherHealth({ ...gdtOk, stuckClaimed: 1, stuckAttempts: 1 })[0].status).toBe("ok");
    expect(gdtWatcherHealth({ ...gdtOk, stuckClaimed: 1, stuckAttempts: 2 })[0].status).toBe("degraded");
  });

  it("CSV health uses the ledger's persisted ignore reason when memory is empty (after restart)", () => {
    const h = csvWatcherHealth({
      ...csvOk,
      lastIgnoreReason: null,
      ledger: { done: 0, failed: 0, ignored: 1, lastError: null, lastIgnoredReason: "no_mapping: Betrag fehlt" },
    })[0];
    expect(h.status).toBe("config_invalid");
    expect(h.lastError).toMatch(/no_mapping/);
  });

  it("no watcher → no rows", () => {
    expect(gdtWatcherHealth(null)).toEqual([]);
    expect(csvWatcherHealth(null)).toEqual([]);
  });
});

describe("pass 2: GDT and CSV in the same folder", () => {
  it("reports the Honorar stream as config_invalid with the reason instead of stopping the agent", () => {
    const rows = csvFolderConflictHealth("Der GDT-Ordner und der Honorar-CSV-Ordner sind derselbe Ordner (C:\X).");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ vendor: "honorar_csv", stream: "csv_folder", status: "config_invalid" });
    expect(rows[0].lastError).toContain("derselbe Ordner");
    expect(rows[0].lastError).toContain("--configure-honorar");
  });
  it("no conflict, no row", () => {
    expect(csvFolderConflictHealth(null)).toEqual([]);
  });
});
