import { describe, it, expect } from "vitest";
import { checkHwg } from "@/server/hwg";
import {
  allReplyTemplates,
  templatesByBucket,
  bucketForRating,
  REPLY_BUCKET_ORDER,
} from "./reply-templates";

describe("reply-templates", () => {
  it("every template text passes the HWG screener without a violation", () => {
    for (const tpl of allReplyTemplates()) {
      const result = checkHwg(tpl.text);
      expect(
        result.verdict,
        `Template "${tpl.id}" must not be an HWG violation`
      ).not.toBe("violation");
    }
  });

  it("contains no em-dashes", () => {
    for (const tpl of allReplyTemplates()) {
      expect(tpl.text.includes("—")).toBe(false);
      expect(tpl.title.includes("—")).toBe(false);
    }
  });

  it("provides at least two templates per bucket", () => {
    for (const bucket of REPLY_BUCKET_ORDER) {
      expect(templatesByBucket(bucket).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("has unique template ids", () => {
    const ids = allReplyTemplates().map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("maps ratings to buckets", () => {
    expect(bucketForRating(5)).toBe("positiv");
    expect(bucketForRating(4)).toBe("positiv");
    expect(bucketForRating(3)).toBe("neutral");
    expect(bucketForRating(2)).toBe("kritisch");
    expect(bucketForRating(1)).toBe("kritisch");
    expect(bucketForRating(null)).toBe("neutral");
  });
});
