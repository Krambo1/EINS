import { describe, expect, it } from "vitest";
import { CHECKLIST_ITEMS_BY_ID, normalizeChecklistLink, validateChecklistFields } from "./content";

describe("normalizeChecklistLink (F-16)", () => {
  it.each([
    ["https://drive.google.com/x", "https://drive.google.com/x"],
    ["drive.google.com/drive/folders/abc", "https://drive.google.com/drive/folders/abc"],
    ["www.dropbox.com/s/abc", "https://www.dropbox.com/s/abc"],
    ["  http://example.de  ", "http://example.de"],
    ["example.com:8080/a", "https://example.com:8080/a"],
  ])("accepts %s", (raw, out) => {
    expect(normalizeChecklistLink(raw)).toBe(out);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "file:///c:/x", "mailto:a@b.de", "ordner", "drive google com", ""])(
    "rejects %s",
    (raw) => {
      expect(normalizeChecklistLink(raw)).toBeNull();
    }
  );

  it("flags a bad link on a link item", () => {
    const linkItem = [...CHECKLIST_ITEMS_BY_ID.values()].find(
      (i) => i.deliveryType === "link" || i.deliveryType === "upload_oder_link"
    )!;
    expect(validateChecklistFields(linkItem, { link: "data:x" }).link).toBeTruthy();
    expect(validateChecklistFields(linkItem, { link: "drive.google.com/x" }).link).toBeUndefined();
  });
});
