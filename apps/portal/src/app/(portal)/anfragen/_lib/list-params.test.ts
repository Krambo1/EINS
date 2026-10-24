import { describe, expect, it } from "vitest";
import { hasListFilter, listQueryString, parseAnfragenParams } from "./list-params";

describe("parseAnfragenParams", () => {
  it("defaults for an empty URL", () => {
    const p = parseAnfragenParams({});
    expect(p).toMatchObject({ page: 1, sort: "neueste", slaBreachedOnly: false, staleOnly: false });
    expect(hasListFilter(p)).toBe(false);
  });

  it("guards page against NaN, zero, negatives and fractions", () => {
    expect(parseAnfragenParams({ page: "abc" }).page).toBe(1);
    expect(parseAnfragenParams({ page: "0" }).page).toBe(1);
    expect(parseAnfragenParams({ page: "-3" }).page).toBe(1);
    expect(parseAnfragenParams({ page: "2.7" }).page).toBe(2);
    expect(parseAnfragenParams({ page: "Infinity" }).page).toBe(1);
  });

  it("drops unknown filter values instead of passing them to SQL", () => {
    const p = parseAnfragenParams({
      status: "neu,quatsch,spam",
      source: "meta,evil",
      aiCategory: "hot,lukewarm",
      treatment: "not-a-uuid,0b0e2c4e-1f1a-4c1b-9a4e-2b9a3f1d7c11",
      sort: "drop table",
    });
    expect(p.status).toEqual(["neu", "spam"]);
    expect(p.source).toEqual(["meta"]);
    expect(p.aiCategory).toEqual(["hot"]);
    expect(p.treatmentId).toEqual(["0b0e2c4e-1f1a-4c1b-9a4e-2b9a3f1d7c11"]);
    expect(p.sort).toBe("neueste");
  });

  it("accepts the PVS-set statuses no_show and behandelt", () => {
    const p = parseAnfragenParams({ status: "no_show,behandelt" });
    expect(p.status).toEqual(["no_show", "behandelt"]);
  });

  it("returns undefined for an all-invalid list and trims the search", () => {
    const p = parseAnfragenParams({ status: "x,y", search: "  Müller  " });
    expect(p.status).toBeUndefined();
    expect(p.search).toBe("Müller");
    expect(parseAnfragenParams({ search: "   " }).search).toBeUndefined();
    expect(parseAnfragenParams({ search: "a".repeat(500) }).search).toHaveLength(200);
  });
});

describe("listQueryString", () => {
  it("keeps every filter and the sort, overrides page", () => {
    const qs = listQueryString(
      { status: "neu", search: "Müller", sort: "aelteste", stale: "1", page: "4", foo: "bar" },
      5
    );
    const p = new URLSearchParams(qs);
    expect(p.get("status")).toBe("neu");
    expect(p.get("search")).toBe("Müller");
    expect(p.get("sort")).toBe("aelteste");
    expect(p.get("stale")).toBe("1");
    expect(p.get("page")).toBe("5");
    expect(p.get("foo")).toBeNull();
  });

  it("drops page for page 1", () => {
    expect(listQueryString({ status: "neu", page: "3" }, 1)).toBe("status=neu");
  });
});
