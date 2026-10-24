import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * loadDueLinks must only list vendors the scheduler can fully serve. RED and
 * HealthHub have an initial sync but no subscription wizard and no incremental
 * pass yet, so a hand-inserted link would finish its initial sync and then go
 * silently dead. Not listing them keeps that visible (the link never starts)
 * instead of half working.
 */

vi.mock("../config.js", () => ({
  env: () => ({
    BRIDGE_DATABASE_URL: "postgres://test:test@localhost:5432/test",
    APP_KEY: "00".repeat(32),
    SCHEDULER_TICK_MS: 30_000,
    FAIL_THRESHOLD: 5,
  }),
}));

const queries: string[] = [];
vi.mock("postgres", () => ({
  default: () => {
    const tag = (strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return Promise.resolve([]);
    };
    return tag;
  },
}));

import { loadDueLinks } from "./client.js";

beforeEach(() => {
  queries.length = 0;
});

describe("loadDueLinks vendor selection", () => {
  it("lists the polling vendors only; red and healthhub are excluded", async () => {
    await loadDueLinks(new Date());
    expect(queries).toHaveLength(1);
    const sql = queries[0]!;
    // Strip SQL comments so the explanation in them cannot satisfy or fail the check.
    const code = sql.replace(/--[^\n]*/g, "");
    expect(code).toMatch(/'tomedo'/);
    expect(code).toMatch(/'pabau'/);
    expect(code).toMatch(/'consentz'/);
    expect(code).not.toMatch(/'red'/);
    expect(code).not.toMatch(/'healthhub'/);
  });

  it("still opts db_read links out", async () => {
    await loadDueLinks(new Date());
    expect(queries[0]).toMatch(/preferred_path <> 'db_read'/);
  });
});
