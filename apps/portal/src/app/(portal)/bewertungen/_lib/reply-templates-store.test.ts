import { describe, it, expect } from "vitest";
import { allReplyTemplates, REPLY_BUCKET_ORDER } from "./reply-templates";
import {
  CUSTOM_TEMPLATES_MAX,
  ReplyTemplateOpSchema,
  applyReplyTemplateOp,
  mergeReplyTemplates,
  parseStoredReplyTemplates,
  type StoredReplyTemplates,
} from "./reply-templates-store";

const EMPTY: StoredReplyTemplates = { edited: {}, custom: [] };
const first = allReplyTemplates()[0]!;
const ownId = "eigene-0a1b2c3d-4e5f";

function apply(current: StoredReplyTemplates, op: unknown) {
  return applyReplyTemplateOp(current, ReplyTemplateOpSchema.parse(op));
}

describe("reply-templates-store", () => {
  it("null or garbage in the column means the shipped templates", () => {
    for (const raw of [null, undefined, "x", { edited: 3 }]) {
      const merged = mergeReplyTemplates(raw);
      expect(merged.map((t) => t.id)).toEqual(allReplyTemplates().map((t) => t.id));
      expect(merged.every((t) => t.origin === "standard")).toBe(true);
    }
  });

  it("an edited standard template keeps its place and is marked", () => {
    const stored = apply(EMPTY, { op: "save", id: first.id, bucket: first.bucket, title: "Neu", text: "Danke!" });
    const merged = mergeReplyTemplates(stored);
    expect(merged[0]).toMatchObject({ id: first.id, title: "Neu", text: "Danke!", origin: "edited" });
  });

  it("saving the shipped words again drops the edit", () => {
    const edited = apply(EMPTY, { op: "save", id: first.id, bucket: first.bucket, title: "X", text: "Y" });
    const back = apply(edited, { op: "save", id: first.id, bucket: first.bucket, title: first.title, text: first.text });
    expect(back.edited).toEqual({});
  });

  it("reset restores the shipped words", () => {
    const edited = apply(EMPTY, { op: "save", id: first.id, bucket: first.bucket, title: "X", text: "Y" });
    const reset = apply(edited, { op: "reset", id: first.id });
    expect(mergeReplyTemplates(reset)[0]).toMatchObject({ title: first.title, text: first.text, origin: "standard" });
  });

  it("own templates land at the end of their group, update in place and delete", () => {
    let stored = apply(EMPTY, { op: "save", id: ownId, bucket: "neutral", title: "Eigen", text: "Text" });
    let merged = mergeReplyTemplates(stored);
    const neutral = merged.filter((t) => t.bucket === "neutral");
    expect(neutral.at(-1)).toMatchObject({ id: ownId, origin: "custom" });
    // Groups stay in display order.
    const order = merged.map((t) => REPLY_BUCKET_ORDER.indexOf(t.bucket));
    expect(order).toEqual([...order].sort((a, b) => a - b));

    stored = apply(stored, { op: "save", id: ownId, bucket: "neutral", title: "Eigen 2", text: "Text" });
    expect(stored.custom).toHaveLength(1);
    expect(stored.custom[0]!.title).toBe("Eigen 2");

    stored = apply(stored, { op: "delete", id: ownId });
    merged = mergeReplyTemplates(stored);
    expect(merged.some((t) => t.id === ownId)).toBe(false);
  });

  it("rejects unknown ids, empty text and too many own templates", () => {
    expect(() => apply(EMPTY, { op: "save", id: "fremd", bucket: "positiv", title: "T", text: "X" })).toThrow(
      "Unbekannte Vorlage."
    );
    expect(() => ReplyTemplateOpSchema.parse({ op: "save", id: ownId, bucket: "positiv", title: "T", text: "  " })).toThrow();
    expect(() => ReplyTemplateOpSchema.parse({ op: "delete", id: first.id })).toThrow();

    const full: StoredReplyTemplates = {
      edited: {},
      custom: Array.from({ length: CUSTOM_TEMPLATES_MAX }, (_, i) => ({
        id: `eigene-${String(i).padStart(8, "0")}`,
        bucket: "positiv" as const,
        title: "T",
        text: "X",
      })),
    };
    expect(parseStoredReplyTemplates(full).custom).toHaveLength(CUSTOM_TEMPLATES_MAX);
    expect(() => apply(full, { op: "save", id: ownId, bucket: "positiv", title: "T", text: "X" })).toThrow(
      /Höchstens/
    );
  });
});
