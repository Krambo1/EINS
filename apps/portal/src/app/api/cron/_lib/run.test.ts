import { afterEach, describe, expect, it, vi } from "vitest";

const { select } = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("@/db/client", () => ({ db: { select }, schema: { clinics: { id: "id", archivedAt: "archived_at" } } }));

const { checkCronAuth, CronRun, activeClinicIds } = await import("./run");
const { cronSecretProblem, isHttpUrl } = await import("@/lib/env");

const ORIGINAL = { secret: process.env.CRON_SECRET, nodeEnv: process.env.NODE_ENV };
afterEach(() => {
  process.env.CRON_SECRET = ORIGINAL.secret;
  (process.env as Record<string, string | undefined>).NODE_ENV = ORIGINAL.nodeEnv;
});

const req = (auth?: string) =>
  ({ headers: new Headers(auth ? { authorization: auth } : {}) }) as never;

describe("CRON_SECRET (V4 Neben 4)", () => {
  it("classifies missing and too short (production only)", () => {
    expect(cronSecretProblem(undefined, "production")).toBe("missing");
    expect(cronSecretProblem("  ", "development")).toBe("missing");
    expect(cronSecretProblem("x".repeat(31), "production")).toBe("too_short");
    expect(cronSecretProblem("x".repeat(32), "production")).toBeNull();
    expect(cronSecretProblem("short", "development")).toBeNull();
  });

  it("a short secret in production answers 503 even with the right header", async () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.CRON_SECRET = "abc";
    const res = checkCronAuth(req("Bearer abc"));
    expect(res?.status).toBe(503);
  });

  it("a long secret in production: right header passes, wrong is 401", () => {
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.CRON_SECRET = "s".repeat(40);
    expect(checkCronAuth(req(`Bearer ${"s".repeat(40)}`))).toBeNull();
    expect(checkCronAuth(req("Bearer nope"))?.status).toBe(401);
  });
});

describe("CLINIC_LANDING_ORIGINS URLs (V4 Neben 5)", () => {
  it("accepts only http(s) URLs", () => {
    expect(isHttpUrl("https://praxis.de")).toBe(true);
    expect(isHttpUrl("http://localhost:3002")).toBe(true);
    expect(isHttpUrl("localhost:3002")).toBe(false);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isHttpUrl("not-a-url")).toBe(false);
    expect(isHttpUrl("ftp://praxis.de")).toBe(false);
  });
});

describe("activeClinicIds inside a step (V4 Neben 9)", () => {
  it("a DB failure is a failed step in the JSON summary, not a throw", async () => {
    select.mockImplementation(() => {
      throw new Error("db down");
    });
    const run = new CronRun("test");
    let clinics: string[] = ["untouched"];
    await run.step("active-clinics", async () => {
      clinics = await activeClinicIds();
    });
    const body = await run.response().json();
    expect(body.ok).toBe(false);
    expect(body.steps[0]).toMatchObject({ step: "active-clinics", ok: false });
    expect(clinics).toEqual(["untouched"]);
  });
});
