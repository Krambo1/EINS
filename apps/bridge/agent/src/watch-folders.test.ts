import { describe, expect, it } from "vitest";
import { watchFolderConflict } from "./watch-folders.js";

describe("watchFolderConflict", () => {
  it("is null when only one folder is configured or they differ", () => {
    expect(watchFolderConflict({ watchFolder: "C:\\GDT" })).toBeNull();
    expect(
      watchFolderConflict({ watchFolder: "C:\\GDT", honorarCsvFolder: "C:\\Honorar" })
    ).toBeNull();
  });

  it("flags the same folder regardless of case, slashes and trailing separator", () => {
    for (const [a, b] of [
      ["C:\\Export", "c:\\export\\"],
      ["C:\\Export", "C:/Export"],
      ["\\\\srv\\share\\gdt", "\\\\SRV\\share\\gdt\\"],
      ["/data/export", "/data/export/"],
    ] as const) {
      expect(watchFolderConflict({ watchFolder: a, honorarCsvFolder: b })).toMatch(/GDT/);
    }
  });

  it("treats POSIX paths as case sensitive", () => {
    expect(
      watchFolderConflict({ watchFolder: "/data/Export", honorarCsvFolder: "/data/export" })
    ).toBeNull();
  });
});
